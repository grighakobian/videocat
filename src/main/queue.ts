import { randomUUID } from 'node:crypto'
import { rmSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'
import type { DownloadItem, FormatChoice, HistoryEntry, Settings, VideoMeta } from '@shared/types'
import type { Store } from './store'
import { YtDlp } from './ytdlp'

/** How often, at most, progress ticks are pushed to the renderer. */
const BROADCAST_INTERVAL_MS = 250

interface JobHandle {
  pause: () => void
  cancel: () => void
}

export interface QueueEvents {
  onChange(): void
  onCompleted(entry: HistoryEntry): void
  onFailed(item: DownloadItem): void
}

function containerLabelFor(choice: FormatChoice): string {
  return choice.containerLabel
}

function qualityLabelFor(choice: FormatChoice): string {
  if (choice.kind === 'audio') return 'Audio'
  return choice.label.split(' · ')[0]
}

/**
 * Owns the live download queue: ordering, the concurrency limit, and the lifecycle of
 * each yt-dlp job. Everything the renderer sees about in-flight downloads comes from here.
 */
export class DownloadQueue {
  private items = new Map<string, DownloadItem>()
  private jobs = new Map<string, JobHandle>()
  /**
   * Files yt-dlp has opened per item. A cancel can arrive long after the process
   * exited — pause, then cancel — so the queue, not the job, owns the cleanup.
   */
  private artifacts = new Map<string, Set<string>>()
  private broadcastTimer: NodeJS.Timeout | null = null
  private broadcastPending = false

  constructor(
    private readonly ytdlp: YtDlp,
    private readonly store: Store,
    private readonly events: QueueEvents
  ) {}

  list(): DownloadItem[] {
    return [...this.items.values()].sort((a, b) => a.addedAt - b.addedAt)
  }

  /**
   * Coalesces change notifications. Progress lines arrive several times a second per job;
   * without this the renderer would re-render far more often than a human can perceive.
   */
  private scheduleBroadcast(immediate = false): void {
    if (immediate) {
      if (this.broadcastTimer) {
        clearTimeout(this.broadcastTimer)
        this.broadcastTimer = null
      }
      this.broadcastPending = false
      this.events.onChange()
      return
    }
    if (this.broadcastTimer) {
      this.broadcastPending = true
      return
    }
    this.events.onChange()
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null
      if (this.broadcastPending) {
        this.broadcastPending = false
        this.scheduleBroadcast()
      }
    }, BROADCAST_INTERVAL_MS)
  }

  private patch(id: string, changes: Partial<DownloadItem>, immediate = false): void {
    const item = this.items.get(id)
    if (!item) return
    this.items.set(id, { ...item, ...changes })
    this.scheduleBroadcast(immediate)
  }

  /**
   * Adds a URL to the queue. The item always waits on the format picker: quality is
   * asked for every download, so nothing starts until `chooseFormat` arrives.
   *
   * `resolved` is metadata someone already probed — the clipboard suggestion resolves a
   * link before offering it — which lets the picker open at once instead of paying for a
   * second probe of the same URL.
   */
  add(url: string, resolved?: VideoMeta): DownloadItem {
    const settings = this.store.getSettings()
    const id = randomUUID()
    const item: DownloadItem = {
      id,
      sourceUrl: resolved?.sourceUrl ?? url,
      title: resolved?.title ?? url,
      uploader: resolved?.uploader ?? null,
      thumbnailUrl: resolved?.thumbnailUrl ?? null,
      durationSeconds: resolved?.durationSeconds ?? null,
      status: 'awaiting-format',
      kind: 'video',
      formatId: null,
      formatLabel: null,
      containerLabel: null,
      qualityLabel: null,
      formats: resolved?.formats ?? [],
      withSubtitles: settings.downloadSubtitles,
      progress: 0,
      stage: resolved ? null : 'Fetching video details',
      speedBytesPerSecond: null,
      etaSeconds: null,
      totalBytes: null,
      downloadedBytes: null,
      outputPath: null,
      error: null,
      addedAt: Date.now(),
      completedAt: null
    }
    this.items.set(id, item)
    this.scheduleBroadcast(true)
    if (!resolved) void this.probe(id, url)
    return item
  }

  private async probe(id: string, url: string): Promise<void> {
    try {
      const meta = await this.ytdlp.probe(url)
      if (!this.items.has(id)) return // canceled while probing
      this.patch(
        id,
        {
          title: meta.title,
          uploader: meta.uploader,
          thumbnailUrl: meta.thumbnailUrl,
          durationSeconds: meta.durationSeconds,
          sourceUrl: meta.sourceUrl,
          formats: meta.formats,
          stage: null
        },
        true
      )
    } catch (error) {
      this.patch(
        id,
        {
          status: 'failed',
          stage: null,
          error: this.friendlyError(error)
        },
        true
      )
      const item = this.items.get(id)
      if (item) this.events.onFailed(item)
    }
  }

  /** Locks in a quality choice and moves the item into the runnable queue. */
  chooseFormat(id: string, formatId: string, withSubtitles: boolean): void {
    const item = this.items.get(id)
    if (!item) return
    const choice = item.formats.find((f) => f.id === formatId)
    if (!choice) return

    this.patch(
      id,
      {
        status: 'queued',
        formatId: choice.id,
        formatLabel: choice.label,
        kind: choice.kind,
        containerLabel: containerLabelFor(choice),
        qualityLabel: qualityLabelFor(choice),
        totalBytes: choice.approxBytes,
        withSubtitles: choice.kind === 'audio' ? false : withSubtitles,
        error: null
      },
      true
    )
    this.pump()
  }

  /** Starts queued items until the concurrency limit is reached. */
  private pump(): void {
    const limit = Math.max(1, this.store.getSettings().maxConcurrentDownloads)
    for (const item of this.list()) {
      if (this.jobs.size >= limit) break
      if (item.status !== 'queued' || this.jobs.has(item.id)) continue
      this.run(item.id)
    }
  }

  private run(id: string): void {
    const item = this.items.get(id)
    if (!item || !item.formatId) return
    const choice = item.formats.find((f) => f.id === item.formatId)
    if (!choice) return

    const settings = this.store.getSettings()
    // yt-dlp's standalone binary takes a while to cold start; say so rather than
    // showing a motionless 0%.
    this.patch(id, { status: 'downloading', error: null, stage: 'Starting…' }, true)

    const job = this.ytdlp.start(
      {
        url: item.sourceUrl,
        choice,
        settings,
        withSubtitles: item.withSubtitles
      },
      {
        onProgress: (update) => {
          const current = this.items.get(id)
          const total = update.totalBytes ?? current?.totalBytes ?? null
          const downloaded = update.downloadedBytes
          const fraction =
            total && downloaded ? Math.min(1, downloaded / total) : (current?.progress ?? 0)
          this.patch(id, {
            downloadedBytes: downloaded,
            totalBytes: total,
            speedBytesPerSecond: update.speedBytesPerSecond,
            etaSeconds: update.etaSeconds,
            // Real bytes are moving now, so drop the "Starting…" placeholder.
            stage: null,
            // The denominator grows when the audio stream starts; never let the bar go back.
            progress: Math.max(current?.progress ?? 0, fraction)
          })
        },
        onStage: (stage) => this.patch(id, { stage, speedBytesPerSecond: null, etaSeconds: null }),
        onDestination: (path) => {
          const known = this.artifacts.get(id) ?? new Set<string>()
          known.add(path)
          this.artifacts.set(id, known)
        }
      }
    )

    this.jobs.set(id, job)
    void job.done.then((outcome) => {
      this.jobs.delete(id)
      this.settle(id, outcome, choice)
      this.pump()
    })
  }

  private settle(
    id: string,
    outcome: Awaited<ReturnType<YtDlp['start']>['done']>,
    choice: FormatChoice
  ): void {
    const item = this.items.get(id)
    if (!item) return

    switch (outcome.type) {
      case 'completed': {
        const entry = this.toHistoryEntry(item, choice, outcome.outputPath)
        if (!entry) {
          // yt-dlp exited cleanly but never told us where the file landed; surface it
          // rather than letting the card vanish with nothing to show for it.
          this.patch(
            id,
            { status: 'failed', error: 'Finished, but the saved file could not be located.' },
            true
          )
          return
        }
        this.items.delete(id)
        this.artifacts.delete(id)
        this.store.addHistoryEntry(entry)
        this.events.onCompleted(entry)
        this.scheduleBroadcast(true)
        return
      }
      case 'paused':
        this.patch(id, { status: 'paused', speedBytesPerSecond: null, etaSeconds: null, stage: null }, true)
        return
      case 'canceled':
        this.discardPartialFiles(id)
        this.items.delete(id)
        this.scheduleBroadcast(true)
        return
      case 'failed':
        this.patch(
          id,
          {
            status: 'failed',
            error: this.friendlyError(outcome.message),
            speedBytesPerSecond: null,
            etaSeconds: null,
            stage: null
          },
          true
        )
        this.events.onFailed({ ...item, status: 'failed', error: outcome.message })
    }
  }

  private toHistoryEntry(
    item: DownloadItem,
    choice: FormatChoice,
    outputPath: string | null
  ): HistoryEntry | null {
    if (!outputPath) return null
    let sizeBytes = item.downloadedBytes ?? choice.approxBytes ?? 0
    try {
      sizeBytes = statSync(outputPath).size
    } catch {
      // Keep the reported size if the file moved between finishing and this stat.
    }
    return {
      id: item.id,
      sourceUrl: item.sourceUrl,
      title: item.title || basename(outputPath, extname(outputPath)),
      uploader: item.uploader,
      thumbnailUrl: item.thumbnailUrl,
      durationSeconds: item.durationSeconds,
      kind: choice.kind,
      containerLabel: containerLabelFor(choice),
      qualityLabel: qualityLabelFor(choice),
      sizeBytes,
      outputPath,
      completedAt: Date.now(),
      fileExists: true
    }
  }

  pause(id: string): void {
    const job = this.jobs.get(id)
    if (job) {
      job.pause()
      return
    }
    // Not running yet — just take it out of contention.
    const item = this.items.get(id)
    if (item?.status === 'queued') this.patch(id, { status: 'paused' }, true)
  }

  resume(id: string): void {
    const item = this.items.get(id)
    if (!item || item.status !== 'paused') return
    this.patch(id, { status: 'queued' }, true)
    this.pump()
  }

  retry(id: string): void {
    const item = this.items.get(id)
    if (!item) return
    if (item.formatId) {
      this.patch(id, { status: 'queued', error: null, progress: 0 }, true)
      this.pump()
    } else {
      this.patch(id, { status: 'awaiting-format', error: null, stage: 'Fetching video details' }, true)
      void this.probe(id, item.sourceUrl)
    }
  }

  cancel(id: string): void {
    const job = this.jobs.get(id)
    if (job) {
      // settle() discards the partial files once the process has actually exited.
      job.cancel()
      return
    }
    this.discardPartialFiles(id)
    this.items.delete(id)
    this.scheduleBroadcast(true)
  }

  /**
   * Deletes what a cancelled item downloaded. Pausing deliberately leaves these in
   * place so `--continue` can resume; cancelling must not strand hundreds of MB.
   */
  private discardPartialFiles(id: string): void {
    for (const path of this.artifacts.get(id) ?? []) {
      rmSync(path, { force: true })
      rmSync(`${path}.part`, { force: true })
    }
    this.artifacts.delete(id)
  }

  pauseAll(): void {
    for (const item of this.list()) {
      if (item.status === 'downloading' || item.status === 'queued') this.pause(item.id)
    }
  }

  resumeAll(): void {
    for (const item of this.list()) {
      if (item.status === 'paused') this.resume(item.id)
    }
  }

  setSubtitles(id: string, withSubtitles: boolean): void {
    this.patch(id, { withSubtitles }, true)
  }

  /** Applies a changed concurrency limit right away. */
  onSettingsChanged(_settings: Settings): void {
    this.pump()
  }

  /**
   * Stops every running job — used on app quit. The queue is in-memory only, so a
   * partial file left behind could never be resumed; delete it here rather than
   * relying on the async settle, which does not finish before the process exits.
   */
  shutdown(): void {
    for (const [id, job] of this.jobs) {
      job.cancel()
      this.discardPartialFiles(id)
    }
    this.jobs.clear()
  }

  private friendlyError(error: unknown): string {
    const raw = error instanceof Error ? error.message : String(error)
    if (/is not a valid URL|Unsupported URL/i.test(raw)) return 'That link is not a supported video URL.'
    if (/Private video/i.test(raw)) return 'This video is private.'
    if (/members-only|Join this channel/i.test(raw)) return 'This video is for channel members only.'
    if (/Sign in to confirm your age|age.?restricted/i.test(raw)) return 'This video is age-restricted and needs a signed-in account.'
    if (/Video unavailable/i.test(raw)) return 'This video is unavailable.'
    // Source-agnostic cases: with ~1750 extractors these turn up far more than the
    // YouTube-specific ones above.
    if (/only works when logged-in|--cookies|requires? (a )?(login|account|subscription)/i.test(raw)) {
      return 'This video needs a signed-in account, which VideoCat cannot do yet.'
    }
    if (/\bnot found\b|HTTP Error 404/i.test(raw)) return 'That video could not be found.'
    if (/geo.?(restricted|blocked)|not available in your country/i.test(raw)) {
      return 'This video is not available in your region.'
    }
    if (/\bDRM\b/i.test(raw)) return 'This video is DRM-protected and cannot be downloaded.'
    if (/ENOENT/i.test(raw)) return 'The download engine is not ready yet. Try again in a moment.'
    if (/Unable to download|urlopen error|getaddrinfo|Temporary failure/i.test(raw)) {
      return 'Could not reach the network. Check your connection and retry.'
    }
    // Keep the tail of yt-dlp's own message; the head is usually a noisy prefix. Cap it,
    // because some extractors emit a paragraph of setup advice on one line.
    const tail = raw.split('\n').filter(Boolean).pop() ?? 'Download failed.'
    return tail.length > 160 ? `${tail.slice(0, 157)}…` : tail
  }
}
