import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { HistoryEntry, Settings } from '@shared/types'

interface Persisted {
  version: 1
  settings: Settings
  history: HistoryEntry[]
  /** Epoch ms of the last `yt-dlp -U` check, so it survives a restart. */
  lastEngineUpdateCheck: number
  /** Last known engine version, keyed to the binary it came from. */
  engineVersion: string | null
  engineBinaryMtimeMs: number | null
}

function defaultSettings(): Settings {
  return {
    downloadDirectory: join(app.getPath('videos'), 'VideoCat'),
    maxConcurrentDownloads: 5,
    watchClipboard: true,
    downloadSubtitles: false,
    limitSpeed: false,
    speedLimitMbps: 5,
    notifyOnComplete: true,
    accentColor: '#E8501F'
  }
}

/**
 * Merges saved settings over the defaults, dropping keys we no longer define, so a
 * setting that a later version removes (the old `defaultQuality`) stops riding along
 * in the file and in the snapshot the renderer sees.
 */
function mergeSettings(saved: Partial<Settings> | undefined): Settings {
  const defaults = defaultSettings()
  const known = Object.entries(saved ?? {}).filter(
    ([key, value]) => key in defaults && value !== undefined
  )
  return { ...defaults, ...Object.fromEntries(known) } as Settings
}

/**
 * Settings and download history, persisted as a single JSON file in userData.
 * Writes go through a temp file so a crash mid-write cannot truncate the store.
 */
export class Store {
  private readonly file = join(app.getPath('userData'), 'videocat.json')
  private data: Persisted

  constructor() {
    this.data = this.load()
    this.ensureDownloadDirectory()
  }

  private load(): Persisted {
    const fallback: Persisted = {
      version: 1,
      settings: defaultSettings(),
      history: [],
      lastEngineUpdateCheck: 0,
      engineVersion: null,
      engineBinaryMtimeMs: null
    }
    if (!existsSync(this.file)) return fallback
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Persisted>
      return {
        version: 1,
        // Merge over defaults so settings added in a later version are populated.
        settings: mergeSettings(parsed.settings),
        history: Array.isArray(parsed.history) ? parsed.history : [],
        lastEngineUpdateCheck: parsed.lastEngineUpdateCheck ?? 0,
        engineVersion: parsed.engineVersion ?? null,
        engineBinaryMtimeMs: parsed.engineBinaryMtimeMs ?? null
      }
    } catch {
      return fallback
    }
  }

  private persist(): void {
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
    renameSync(tmp, this.file)
  }

  private ensureDownloadDirectory(): void {
    try {
      mkdirSync(this.data.settings.downloadDirectory, { recursive: true })
    } catch {
      // A missing/unwritable folder surfaces as a download error later, where we can show it.
    }
  }

  getSettings(): Settings {
    return { ...this.data.settings }
  }

  updateSettings(patch: Partial<Settings>): Settings {
    this.data.settings = { ...this.data.settings, ...patch }
    if (patch.downloadDirectory) this.ensureDownloadDirectory()
    this.persist()
    return this.getSettings()
  }

  getLastEngineUpdateCheck(): number {
    return this.data.lastEngineUpdateCheck
  }

  setLastEngineUpdateCheck(timestamp: number): void {
    this.data.lastEngineUpdateCheck = timestamp
    this.persist()
  }

  /** Cached engine version, valid only while the binary's mtime is unchanged. */
  getCachedEngineVersion(mtimeMs: number): string | null {
    return this.data.engineBinaryMtimeMs === mtimeMs ? this.data.engineVersion : null
  }

  setCachedEngineVersion(version: string, mtimeMs: number): void {
    this.data.engineVersion = version
    this.data.engineBinaryMtimeMs = mtimeMs
    this.persist()
  }

  getHistory(): HistoryEntry[] {
    return this.data.history.map((entry) => ({ ...entry }))
  }

  addHistoryEntry(entry: HistoryEntry): void {
    // Same file downloaded again replaces its entry rather than stacking duplicates.
    this.data.history = [
      entry,
      ...this.data.history.filter((e) => e.id !== entry.id && e.outputPath !== entry.outputPath)
    ]
    this.persist()
  }

  removeHistoryEntry(id: string): void {
    this.data.history = this.data.history.filter((entry) => entry.id !== id)
    this.persist()
  }

  clearHistory(): void {
    this.data.history = []
    this.persist()
  }

  /**
   * Marks entries whose file has since been moved or deleted (or put back), so the UI
   * can show them as missing. `changed` lets callers skip a push when nothing moved.
   */
  refreshFileExistence(): { history: HistoryEntry[]; changed: boolean } {
    let changed = false
    this.data.history = this.data.history.map((entry) => {
      const exists = existsSync(entry.outputPath)
      if (exists !== entry.fileExists) changed = true
      return exists === entry.fileExists ? entry : { ...entry, fileExists: exists }
    })
    if (changed) this.persist()
    return { history: this.getHistory(), changed }
  }
}
