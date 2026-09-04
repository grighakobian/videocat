import { clipboard } from 'electron'
import type { ClipboardHit } from '@shared/types'

const POLL_INTERVAL_MS = 1200

/** Hosts we treat as downloadable. YouTube only for now, per the MVP scope. */
const SUPPORTED_HOSTS = [
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be'
]

export function isSupportedUrl(text: string): boolean {
  try {
    const url = new URL(text.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    return SUPPORTED_HOSTS.includes(url.hostname.toLowerCase())
  } catch {
    return false
  }
}

/**
 * Polls the clipboard for video links. Electron has no clipboard-change event, so a
 * short interval is the only option; it only reads text and never writes.
 */
export class ClipboardWatcher {
  private timer: NodeJS.Timeout | null = null
  private lastSeen = ''
  private polling = false
  /** URLs the user already dismissed or downloaded, so we do not nag about them again. */
  private ignored = new Set<string>()

  constructor(private readonly onHit: (hit: ClipboardHit) => void) {}

  start(): void {
    if (this.timer) return
    // Seed with whatever is on the clipboard now so launching does not fire immediately.
    void clipboard.readText().then((text) => {
      this.lastSeen = text.trim()
    })
    this.timer = setInterval(() => void this.poll(), POLL_INTERVAL_MS)
  }

  stop(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
  }

  /** Called when a link is downloaded or dismissed so it stops being offered. */
  ignore(url: string): void {
    this.ignored.add(url.trim())
  }

  private async poll(): Promise<void> {
    // Electron's clipboard read is async; skip a tick rather than let reads overlap.
    if (this.polling) return
    this.polling = true
    try {
      const text = (await clipboard.readText()).trim()
      if (!text || text === this.lastSeen) return
      this.lastSeen = text
      if (!isSupportedUrl(text) || this.ignored.has(text)) return
      this.onHit({ url: text, title: null })
    } catch {
      // A transient clipboard read failure just means we try again next tick.
    } finally {
      this.polling = false
    }
  }
}
