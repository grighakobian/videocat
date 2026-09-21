/** Types shared across the main process, preload bridge, and renderer. */

export type PageId = 'downloads' | 'library' | 'settings'

export type MediaKind = 'video' | 'audio'

export type DownloadStatus =
  | 'awaiting-format' // metadata resolved, waiting for the user to pick a quality
  | 'queued' // format chosen, waiting for a concurrency slot
  | 'downloading'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'canceled'

/** A single selectable output for a video, derived from yt-dlp's format list. */
export interface FormatChoice {
  /** Stable id we hand back when starting the download, e.g. `video:1080` or `audio:mp3`. */
  id: string
  label: string // "1080p · MP4"
  detail: string // "640 MB" or "estimated"
  kind: MediaKind
  height: number | null
  /** Video codec of the stream this resolves to, e.g. "H.264", "VP9". Null for audio. */
  codecLabel: string | null
  /** Container the finished file will actually use, e.g. "MP4", "WEBM", "MP3 320k". */
  containerLabel: string
  /**
   * False when the result needs a modern player. YouTube only offers H.264 up to
   * 1080p, so 1440p and 4K necessarily arrive as VP9 or AV1, which QuickTime and
   * older Windows players cannot decode.
   */
  widelyCompatible: boolean
  /** yt-dlp -f selector this choice maps to. */
  selector: string
  /** Bytes, when yt-dlp reports (or estimates) a size. */
  approxBytes: number | null
}

/** Everything we learn about a URL before downloading it. */
export interface VideoMeta {
  sourceUrl: string
  videoId: string | null
  title: string
  uploader: string | null
  durationSeconds: number | null
  thumbnailUrl: string | null
  isLive: boolean
  formats: FormatChoice[]
}

/** A live item in the download queue. */
export interface DownloadItem {
  id: string
  sourceUrl: string
  title: string
  uploader: string | null
  thumbnailUrl: string | null
  durationSeconds: number | null
  status: DownloadStatus
  kind: MediaKind
  /** Chosen format, null while `awaiting-format`. */
  formatId: string | null
  formatLabel: string | null
  /** Container/codec label for chips: "MP4", "MP3 320k". */
  containerLabel: string | null
  qualityLabel: string | null // "1080p", "Audio"
  formats: FormatChoice[]
  withSubtitles: boolean
  progress: number // 0..1
  /** Human-readable phase, e.g. "Merging video and audio". Null while plainly downloading. */
  stage: string | null
  speedBytesPerSecond: number | null
  etaSeconds: number | null
  totalBytes: number | null
  downloadedBytes: number | null
  /** Absolute path once finished. */
  outputPath: string | null
  error: string | null
  addedAt: number
  completedAt: number | null
}

/** A finished download, persisted to history. */
export interface HistoryEntry {
  id: string
  sourceUrl: string
  title: string
  uploader: string | null
  thumbnailUrl: string | null
  durationSeconds: number | null
  kind: MediaKind
  containerLabel: string
  qualityLabel: string
  sizeBytes: number
  outputPath: string
  completedAt: number
  /** False once we notice the file is gone from disk. */
  fileExists: boolean
}

export interface Settings {
  downloadDirectory: string
  maxConcurrentDownloads: number
  watchClipboard: boolean
  downloadSubtitles: boolean
  limitSpeed: boolean
  speedLimitMbps: number
  notifyOnComplete: boolean
  accentColor: string
}

export interface DiskSpace {
  freeBytes: number
  totalBytes: number
}

/** Provisioning state for the yt-dlp binary, surfaced in the UI. */
export interface EngineStatus {
  state: 'checking' | 'downloading' | 'ready' | 'error'
  version: string | null
  message: string | null
  progress: number | null
}

/**
 * A link found on the clipboard that yt-dlp has already resolved to real media. Only
 * resolved links are offered, so the suggestion can show what it found rather than
 * asking about any URL that happened to be copied. The whole probe result travels with
 * it: the offer shows the same artwork, title and quality list a queued card shows, so
 * accepting it is one click on a rung rather than a download that starts blind.
 */
export interface ClipboardHit {
  url: string
  meta: VideoMeta
}

export interface AppSnapshot {
  settings: Settings
  queue: DownloadItem[]
  history: HistoryEntry[]
  disk: DiskSpace | null
  engine: EngineStatus
  /** A clipboard suggestion still standing, so a renderer that mounts late still sees it. */
  clipboardHit: ClipboardHit | null
}
