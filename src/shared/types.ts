/** Types shared across the main process, preload bridge, and renderer. */

export type PageId = 'downloads' | 'completed' | 'library' | 'settings'

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

export type DefaultQuality = '720' | '1080' | 'best'

export interface Settings {
  downloadDirectory: string
  defaultQuality: DefaultQuality
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

export interface ClipboardHit {
  url: string
  title: string | null
}

export interface AppSnapshot {
  settings: Settings
  queue: DownloadItem[]
  history: HistoryEntry[]
  disk: DiskSpace | null
  engine: EngineStatus
}
