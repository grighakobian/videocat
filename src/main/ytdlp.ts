import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { promisify } from 'node:util'
import { formatBytes } from '@shared/format'
import type { FormatChoice, Settings, VideoMeta } from '@shared/types'
import type { BinaryManager } from './binaries'

const execFileAsync = promisify(execFile)

/** Set GRABBIT_DEBUG=1 to echo every raw yt-dlp line to the terminal. */
const DEBUG = process.env.GRABBIT_DEBUG === '1'

/** Marker we ask yt-dlp to prefix the final filepath with, so we can spot it on stdout. */
const FILE_MARKER = 'GRABBIT_FILE:'
const PROGRESS_MARKER = 'GRABBIT_PROGRESS'
const ALREADY_DOWNLOADED = 'has already been downloaded'

/**
 * Resolution first, then the most widely playable codecs. Resolution has to lead:
 * YouTube only serves H.264 up to 1080p, so sorting by codec first would silently
 * hand back a 1080p file to someone who asked for 4K.
 *
 * Both the probe and the download pass this, which is what keeps the size in the
 * picker equal to the size on disk.
 */
const FORMAT_SORT = 'res,vcodec:h264,acodec:aac'
const DESTINATION_PREFIX = '[download] Destination:'
const THUMBNAIL_PREFIX = '[info] Writing video thumbnail'

const PROGRESS_TEMPLATE = [
  `download:${PROGRESS_MARKER}`,
  '%(progress.status)s',
  '%(progress.downloaded_bytes)s',
  '%(progress.total_bytes)s',
  '%(progress.total_bytes_estimate)s',
  '%(progress.speed)s',
  '%(progress.eta)s'
].join('|')

/** Heights we offer, when the video actually has them. */
const OFFERED_HEIGHTS = [2160, 1440, 1080, 720, 480, 360]

/** Keep the picker to the design's density — the top few rungs a video actually has. */
const MAX_VIDEO_CHOICES = 4

/** Bitrate we ask ffmpeg for when extracting audio, so the label and estimate stay honest. */
const MP3_BITRATE_KBPS = 320

const HEIGHT_LABELS: Record<number, string> = { 2160: '4K', 1440: '1440p' }

/** Human name for a stream's video codec, and whether it plays without a modern player. */
const VCODEC_LABELS: [prefix: string, label: string, widelyCompatible: boolean][] = [
  ['avc1', 'H.264', true],
  ['h264', 'H.264', true],
  ['hev1', 'HEVC', false],
  ['hvc1', 'HEVC', false],
  ['vp09', 'VP9', false],
  ['vp9', 'VP9', false],
  ['av01', 'AV1', false]
]

function describeVcodec(codec: string | undefined): { label: string | null; compatible: boolean } {
  if (!codec || codec === 'none') return { label: null, compatible: true }
  const match = VCODEC_LABELS.find(([prefix]) => codec.toLowerCase().startsWith(prefix))
  // An unrecognised codec is reported as-is rather than silently claimed compatible.
  return match
    ? { label: match[1], compatible: match[2] }
    : { label: codec.split('.')[0].toUpperCase(), compatible: false }
}

export const AUDIO_FORMAT_ID = 'audio:mp3'

interface RawFormat {
  format_id?: string
  ext?: string
  height?: number | null
  vcodec?: string
  acodec?: string
  filesize?: number | null
  filesize_approx?: number | null
  tbr?: number | null
}

interface RawInfo {
  id?: string
  title?: string
  uploader?: string | null
  channel?: string | null
  duration?: number | null
  thumbnail?: string | null
  is_live?: boolean
  formats?: RawFormat[]
  webpage_url?: string
}

export interface ProgressUpdate {
  downloadedBytes: number | null
  totalBytes: number | null
  speedBytesPerSecond: number | null
  etaSeconds: number | null
}

export interface JobCallbacks {
  onProgress(update: ProgressUpdate): void
  onStage(stage: string | null): void
  /** Every file yt-dlp opens for this job, so a cancel can clean up after itself. */
  onDestination(path: string): void
}

export type JobOutcome =
  | { type: 'completed'; outputPath: string | null }
  | { type: 'paused' }
  | { type: 'canceled' }
  | { type: 'failed'; message: string }

function numberOrNull(raw: string | undefined): number | null {
  if (!raw || raw === 'NA' || raw === 'None') return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

function isVideoOnly(format: RawFormat): boolean {
  return format.vcodec !== 'none' && format.acodec === 'none'
}

function isAudioOnly(format: RawFormat): boolean {
  return format.vcodec === 'none' && format.acodec !== 'none'
}

/**
 * Byte size of a stream. YouTube omits `filesize` on its newest high-bitrate formats,
 * so fall back to bitrate x duration — approximate, but far better than "unknown".
 */
function sizeOf(format: RawFormat | undefined, durationSeconds: number | null): number | null {
  if (!format) return null
  const exact = format.filesize ?? format.filesize_approx ?? null
  if (exact !== null) return exact
  if (format.tbr && durationSeconds) return Math.round((format.tbr * 1000 * durationSeconds) / 8)
  return null
}

/** True when neither the stream nor any sibling reported a real byte count. */
function isEstimated(format: RawFormat | undefined): boolean {
  return Boolean(format) && (format?.filesize ?? format?.filesize_approx ?? null) === null
}

function heightLabel(height: number): string {
  return HEIGHT_LABELS[height] ?? `${height}p`
}

/**
 * The stream our selector will actually land on. yt-dlp returns `formats` already
 * ordered worst-to-best under the `--format-sort` we passed, so the last match is
 * precisely what `bestvideo[height<=H]` resolves to — no need to replicate its
 * ranking rules here, and no way for the two to drift apart.
 */
function bestVideoAt(formats: RawFormat[], height: number): RawFormat | undefined {
  return formats
    .filter((f) => isVideoOnly(f) && typeof f.height === 'number' && f.height <= height)
    .at(-1)
}

/** What `bestaudio` resolves to — again, the last entry in yt-dlp's sorted list. */
function bestAudio(formats: RawFormat[]): RawFormat | undefined {
  return formats.filter(isAudioOnly).at(-1)
}

function sizeLabel(bytes: number | null, estimated: boolean): string {
  if (bytes === null) return 'size unknown'
  return estimated ? `~${formatBytes(bytes)}` : formatBytes(bytes)
}

/** Progressive (already-muxed) stream, the fallback when a video has no adaptive formats. */
function bestProgressiveAt(formats: RawFormat[], height: number): RawFormat | undefined {
  return formats
    .filter((f) => f.vcodec !== 'none' && f.acodec !== 'none' && (f.height ?? 0) <= height)
    .at(-1)
}

export function buildFormatChoices(formats: RawFormat[], durationSeconds: number | null): FormatChoice[] {
  const choices: FormatChoice[] = []
  const availableHeights = new Set(
    formats.filter((f) => f.vcodec !== 'none' && f.height).map((f) => f.height as number)
  )

  for (const height of OFFERED_HEIGHTS) {
    // Only offer a rung the video can actually reach.
    if (![...availableHeights].some((h) => h >= height)) continue
    if (choices.length >= MAX_VIDEO_CHOICES) break

    const video = bestVideoAt(formats, height)
    const audio = bestAudio(formats)
    const progressive = bestProgressiveAt(formats, height)

    let approxBytes: number | null = null
    let estimated = false
    if (video && audio) {
      const videoSize = sizeOf(video, durationSeconds)
      const audioSize = sizeOf(audio, durationSeconds)
      if (videoSize !== null && audioSize !== null) {
        approxBytes = videoSize + audioSize
        estimated = isEstimated(video) || isEstimated(audio)
      }
    }
    if (approxBytes === null) {
      approxBytes = sizeOf(progressive, durationSeconds)
      estimated = isEstimated(progressive)
    }

    const codec = describeVcodec((video ?? progressive)?.vcodec)
    choices.push({
      id: `video:${height}`,
      label: `${heightLabel(height)} · MP4`,
      detail: [sizeLabel(approxBytes, estimated), codec.label].filter(Boolean).join(' · '),
      kind: 'video',
      height,
      codecLabel: codec.label,
      widelyCompatible: codec.compatible,
      // Codec preference is expressed through FORMAT_SORT, not here, so that asking
      // for 4K never quietly resolves to a lower-resolution H.264 stream.
      selector: `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]`,
      approxBytes
    })
  }

  if (choices.length === 0) {
    // Live streams and odd extractors report no heights; still let the user grab "best".
    const codec = describeVcodec(bestVideoAt(formats, Number.MAX_SAFE_INTEGER)?.vcodec)
    choices.push({
      id: 'video:best',
      label: 'Best available · MP4',
      detail: ['size unknown', codec.label].filter(Boolean).join(' · '),
      kind: 'video',
      height: null,
      codecLabel: codec.label,
      widelyCompatible: codec.compatible,
      selector: 'bestvideo+bestaudio/best',
      approxBytes: null
    })
  }

  const audio = bestAudio(formats)
  // MP3 is re-encoded at a fixed bitrate, so the source size is not the output size.
  const mp3Bytes = durationSeconds
    ? Math.round((durationSeconds * MP3_BITRATE_KBPS * 1000) / 8)
    : sizeOf(audio, durationSeconds)
  choices.push({
    id: AUDIO_FORMAT_ID,
    label: 'MP3 only',
    detail: sizeLabel(mp3Bytes, true),
    kind: 'audio',
    height: null,
    codecLabel: null,
    // MP3 plays everywhere, whatever the source stream was.
    widelyCompatible: true,
    selector: 'bestaudio/best',
    approxBytes: mp3Bytes
  })

  return choices
}

/** Thin wrapper around the yt-dlp binary: metadata probes and download jobs. */
export class YtDlp {
  constructor(private readonly binaries: BinaryManager) {}

  /** Resolves a URL to title, thumbnail, duration, and the quality choices we can offer. */
  async probe(url: string): Promise<VideoMeta> {
    const args = [
      '--dump-single-json',
      '--no-playlist',
      '--no-warnings',
      '--no-progress',
      '--socket-timeout',
      '20',
      '--format-sort',
      FORMAT_SORT,
      ...this.binaries.jsRuntimeArgs(),
      url
    ]
    const { stdout } = await execFileAsync(this.binaries.ytdlp(), args, {
      timeout: 90_000,
      maxBuffer: 64 * 1024 * 1024,
      env: this.binaries.childEnv()
    })
    const info = JSON.parse(stdout) as RawInfo
    const duration = typeof info.duration === 'number' ? info.duration : null

    return {
      sourceUrl: info.webpage_url ?? url,
      videoId: info.id ?? null,
      title: info.title?.trim() || 'Untitled',
      uploader: info.uploader ?? info.channel ?? null,
      durationSeconds: duration,
      thumbnailUrl: info.thumbnail ?? null,
      isLive: Boolean(info.is_live),
      formats: buildFormatChoices(info.formats ?? [], duration)
    }
  }

  private buildDownloadArgs(options: {
    url: string
    choice: FormatChoice
    settings: Settings
    withSubtitles: boolean
  }): string[] {
    const { url, choice, settings, withSubtitles } = options
    const args = [
      '--no-playlist',
      '--newline',
      '--no-warnings',
      '--continue',
      '--no-overwrites',
      // `--print` implies `--quiet`, which would suppress every progress line.
      '--no-quiet',
      '--progress-template',
      PROGRESS_TEMPLATE,
      '--print',
      `after_move:${FILE_MARKER}%(filepath)s`,
      '--paths',
      settings.downloadDirectory,
      '--output',
      '%(title).180B [%(id)s].%(ext)s',
      '--format',
      choice.selector,
      '--format-sort',
      FORMAT_SORT,
      ...this.binaries.jsRuntimeArgs()
    ]

    const ffmpegDir = this.binaries.ffmpegDir()
    if (ffmpegDir) args.push('--ffmpeg-location', ffmpegDir)

    if (choice.kind === 'audio') {
      // A fixed CBR keeps the "MP3 320k" chip and the size estimate truthful.
      args.push(
        '--extract-audio',
        '--audio-format',
        'mp3',
        '--audio-quality',
        `${MP3_BITRATE_KBPS}K`,
        '--embed-thumbnail'
      )
    } else {
      args.push('--merge-output-format', 'mp4')
      if (withSubtitles) {
        args.push('--write-subs', '--write-auto-subs', '--sub-langs', 'en.*', '--convert-subs', 'srt')
      }
    }

    if (settings.limitSpeed && settings.speedLimitMbps > 0) {
      args.push('--limit-rate', `${settings.speedLimitMbps}M`)
    }

    args.push(url)
    return args
  }

  /**
   * Starts a download. The returned handle exposes `pause` (SIGTERM, leaving the .part
   * file for `--continue` to resume from) and `cancel` (stop and discard).
   */
  start(
    options: { url: string; choice: FormatChoice; settings: Settings; withSubtitles: boolean },
    callbacks: JobCallbacks
  ): { done: Promise<JobOutcome>; pause: () => void; cancel: () => void } {
    const child: ChildProcessWithoutNullStreams = spawn(
      this.binaries.ytdlp(),
      this.buildDownloadArgs(options),
      { windowsHide: true, env: this.binaries.childEnv() }
    )

    let intent: 'run' | 'pause' | 'cancel' = 'run'
    let outputPath: string | null = null
    let alreadyDownloadedPath: string | null = null
    let lastError = ''

    // A merged download is two sequential yt-dlp downloads (video, then audio), each
    // reporting its own 0->100%. Accumulate finished streams so the bar only moves forward.
    let completedStreamBytes = 0
    let currentStreamTotal: number | null = null

    const handleLine = (line: string): void => {
      const trimmed = line.trim()
      if (!trimmed) return
      if (DEBUG) console.error('[yt-dlp]', JSON.stringify(trimmed))

      if (trimmed.startsWith(PROGRESS_MARKER)) {
        const [, status, downloaded, total, totalEstimate, speed, eta] = trimmed.split('|')
        const streamDownloaded = numberOrNull(downloaded)
        const streamTotal = numberOrNull(total) ?? numberOrNull(totalEstimate)

        if (status === 'finished') {
          completedStreamBytes += streamDownloaded ?? currentStreamTotal ?? 0
          currentStreamTotal = null
          callbacks.onProgress({
            downloadedBytes: completedStreamBytes,
            totalBytes: completedStreamBytes,
            speedBytesPerSecond: null,
            etaSeconds: null
          })
          return
        }

        currentStreamTotal = streamTotal
        callbacks.onProgress({
          downloadedBytes: completedStreamBytes + (streamDownloaded ?? 0),
          totalBytes: streamTotal === null ? null : completedStreamBytes + streamTotal,
          speedBytesPerSecond: numberOrNull(speed),
          etaSeconds: numberOrNull(eta)
        })
        return
      }

      if (trimmed.startsWith(FILE_MARKER)) {
        outputPath = trimmed.slice(FILE_MARKER.length).trim()
        return
      }

      if (trimmed.startsWith(DESTINATION_PREFIX)) {
        callbacks.onDestination(trimmed.slice(DESTINATION_PREFIX.length).trim())
        return
      }

      if (trimmed.startsWith(THUMBNAIL_PREFIX)) {
        // "[info] Writing video thumbnail 41 to: /path/name.webp"
        const marker = ' to: '
        const at = trimmed.indexOf(marker)
        if (at !== -1) callbacks.onDestination(trimmed.slice(at + marker.length).trim())
        return
      }

      if (trimmed.startsWith('[Merger]')) callbacks.onStage('Merging video and audio')
      else if (trimmed.startsWith('[ExtractAudio]')) callbacks.onStage('Converting to MP3')
      else if (trimmed.startsWith('[EmbedThumbnail]')) callbacks.onStage('Embedding artwork')
      else if (trimmed.startsWith('[download]') && trimmed.includes(ALREADY_DOWNLOADED)) {
        // `--no-overwrites` skips the file, so `after_move` never fires — take the path
        // from this line instead, or the finished download would have nothing to show.
        alreadyDownloadedPath = trimmed
          .slice('[download]'.length, trimmed.indexOf(ALREADY_DOWNLOADED))
          .trim()
        callbacks.onStage(null)
      }
    }

    const pipeLines = (stream: NodeJS.ReadableStream, onLine: (line: string) => void): void => {
      let buffer = ''
      stream.on('data', (chunk: Buffer) => {
        buffer += chunk.toString()
        // yt-dlp rewrites the progress line with \r when not in --newline mode; split on both.
        const lines = buffer.split(/\r?\n|\r/)
        buffer = lines.pop() ?? ''
        for (const line of lines) onLine(line)
      })
      stream.on('end', () => {
        if (buffer) onLine(buffer)
      })
    }

    pipeLines(child.stdout, handleLine)
    pipeLines(child.stderr, (line) => {
      handleLine(line)
      const trimmed = line.trim()
      if (trimmed.startsWith('ERROR:')) lastError = trimmed.replace(/^ERROR:\s*/, '')
    })

    const done = new Promise<JobOutcome>((resolve) => {
      child.on('error', (error) => {
        resolve({ type: 'failed', message: error.message })
      })
      child.on('close', (code) => {
        if (intent === 'pause') resolve({ type: 'paused' })
        else if (intent === 'cancel') resolve({ type: 'canceled' })
        else if (code === 0) resolve({ type: 'completed', outputPath: outputPath ?? alreadyDownloadedPath })
        else resolve({ type: 'failed', message: lastError || `yt-dlp exited with code ${code}` })
      })
    })

    const stop = (nextIntent: 'pause' | 'cancel'): void => {
      intent = nextIntent
      // SIGTERM lets yt-dlp flush the .part file; SIGKILL after a grace period if it hangs.
      child.kill('SIGTERM')
      const killTimer = setTimeout(() => child.kill('SIGKILL'), 5_000)
      void done.finally(() => clearTimeout(killTimer))
    }

    return { done, pause: () => stop('pause'), cancel: () => stop('cancel') }
  }
}
