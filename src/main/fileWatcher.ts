import { watch, type FSWatcher } from 'node:fs'
import { basename, dirname } from 'node:path'

/** Bursts of events (a Finder move fires several) collapse into one re-check. */
const SETTLE_MS = 400

/**
 * Watches the folders that hold finished downloads, so a file the user moves or deletes
 * while the app is open is reflected in history right away instead of on the next
 * launch. It only watches folders that currently hold a history entry, and only reacts
 * to events for those entries' names — the download folder is busy while yt-dlp writes
 * .part files, and none of that churn is worth a re-stat.
 *
 * Deliberately not recursive: `fs.watch` recursion is unreliable across platforms and
 * every history path is known, so watching each parent folder is enough. A folder that
 * cannot be watched (deleted, unmounted) is simply skipped; its files are reported as
 * missing by the next re-check, and `sync()` tries to open it again each time it runs.
 */
export class HistoryFileWatcher {
  private readonly watchers = new Map<string, FSWatcher>()
  private readonly names = new Map<string, Set<string>>()
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly onChange: () => void) {}

  /** Points the watcher at exactly the folders these files live in. Idempotent. */
  sync(paths: string[]): void {
    const wanted = new Map<string, Set<string>>()
    for (const path of paths) {
      const dir = dirname(path)
      const set = wanted.get(dir) ?? new Set<string>()
      set.add(basename(path))
      wanted.set(dir, set)
    }

    for (const [dir, watcher] of this.watchers) {
      if (wanted.has(dir)) continue
      watcher.close()
      this.watchers.delete(dir)
    }
    this.names.clear()
    for (const [dir, set] of wanted) {
      this.names.set(dir, set)
      if (!this.watchers.has(dir)) this.open(dir)
    }
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    for (const watcher of this.watchers.values()) watcher.close()
    this.watchers.clear()
    this.names.clear()
  }

  private open(dir: string): void {
    try {
      // `persistent: false` so a forgotten watcher can never keep the process alive.
      const watcher = watch(dir, { persistent: false }, (_event, filename) => {
        // `filename` is null on some platforms; when it is present, ignore everything
        // that is not one of ours (yt-dlp's .part files, unrelated downloads).
        const name = filename == null ? null : String(filename)
        if (name !== null && !this.names.get(dir)?.has(name)) return
        this.schedule()
      })
      watcher.on('error', () => {
        // The folder itself went away or became unreadable. Drop the handle; the files
        // in it are now missing, which the re-check reports.
        watcher.close()
        this.watchers.delete(dir)
        this.schedule()
      })
      this.watchers.set(dir, watcher)
    } catch {
      // Folder does not exist right now — nothing to watch, but its entries should
      // read as missing, so still ask for a re-check.
      this.schedule()
    }
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.onChange()
    }, SETTLE_MS)
  }
}
