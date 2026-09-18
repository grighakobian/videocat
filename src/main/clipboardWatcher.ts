import { clipboard } from 'electron'

const POLL_INTERVAL_MS = 1200

/**
 * Whether a string is a web address worth handing to yt-dlp.
 *
 * Deliberately not a host allowlist: yt-dlp supports well over a thousand sites, and
 * maintaining a list here would reject most of them. Anything yt-dlp cannot extract
 * comes back as a normal download error, which is a better answer than refusing the
 * paste. All we check is that it is an http(s) URL rather than arbitrary text.
 */
export function isHttpUrl(text: string): boolean {
  try {
    const url = new URL(text.trim())
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Polls the clipboard for links. Electron has no clipboard-change event, so a short
 * interval is the only option; it only reads text and never writes.
 *
 * Every http(s) URL is handed on as a *candidate*, since yt-dlp's reach is far too wide
 * to predict from the host alone. Whether one is worth mentioning is decided by probing
 * it (see `resolveClipboardLink` in `index.ts`) — this class stays a dumb poller. The
 * banner is dismissible, dismissed links are never offered again, and the whole watcher
 * can be turned off in Settings.
 */
export class ClipboardWatcher {
  private timer: NodeJS.Timeout | null = null
  private lastSeen = ''
  private polling = false
  /** URLs the user already dismissed or downloaded, so we do not nag about them again. */
  private ignored = new Set<string>()

  constructor(private readonly onCandidate: (url: string) => void) {}

  start(): void {
    if (this.timer) return
    // Check what is already on the clipboard rather than swallowing it: a link copied
    // just before launching (or before switching watching back on) is the likeliest
    // thing the user wants, and resolving it first means a non-media link stays silent.
    void this.poll()
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
      if (!isHttpUrl(text) || this.ignored.has(text)) return
      this.onCandidate(text)
    } catch {
      // A transient clipboard read failure just means we try again next tick.
    } finally {
      this.polling = false
    }
  }
}
