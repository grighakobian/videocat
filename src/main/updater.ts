import { app } from 'electron'
// Statically, not `await import(…)`: electron-updater is CommonJS, and in the bundled
// main process a dynamic import hands back a namespace whose `autoUpdater` is undefined
// — the packaged app then fails with "Cannot set properties of undefined".
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '@shared/types'

/**
 * App updates, over electron-updater and the GitHub releases feed configured in
 * electron-builder.yml.
 *
 * Checking is always something the user asked for: no background poll, no notification
 * out of nowhere. A found update downloads straight away — having said yes to the
 * check, being asked a second time to accept the bytes is noise — and then waits for a
 * restart, because replacing a running app underneath an in-flight download is not
 * something to do without being told.
 *
 * yt-dlp is not part of this. It lives in `userData/bin`, outside the bundle, so it
 * survives an app update and keeps its own once-a-day check; a new VideoCat brings a
 * newer engine along only in the sense that a fresh install provisions the latest one.
 */
export class AppUpdater {
  private status: UpdateStatus = { state: 'idle', version: null, progress: null, message: null }

  constructor(private readonly onChange: (status: UpdateStatus) => void) {
    // The download is ours to start, once a check has found something.
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('update-available', (info) => {
      this.setStatus({ state: 'downloading', version: info.version, progress: 0, message: null })
      void autoUpdater.downloadUpdate().catch((error: unknown) => this.fail(error))
    })
    autoUpdater.on('update-not-available', () => {
      this.setStatus({
        state: 'up-to-date',
        version: app.getVersion(),
        progress: null,
        message: null
      })
    })
    autoUpdater.on('download-progress', (progress) => {
      this.setStatus({ state: 'downloading', progress: (progress.percent ?? 0) / 100 })
    })
    autoUpdater.on('update-downloaded', (info) => {
      this.setStatus({ state: 'ready', version: info.version, progress: null, message: null })
    })
    autoUpdater.on('error', (error) => this.fail(error))
  }

  getStatus(): UpdateStatus {
    return { ...this.status }
  }

  private setStatus(patch: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...patch }
    this.onChange(this.getStatus())
  }

  private fail(error: unknown): void {
    this.setStatus({
      state: 'error',
      progress: null,
      message: friendlyUpdateError(error)
    })
  }

  /**
   * An unpackaged app has no bundle to replace and no feed to read, so say so instead
   * of surfacing electron-updater's "dev-app-update.yml not found".
   */
  async check(): Promise<UpdateStatus> {
    if (!app.isPackaged) {
      this.setStatus({
        state: 'unsupported',
        version: app.getVersion(),
        progress: null,
        message: 'Updates arrive in installed builds; this one runs from source.'
      })
      return this.getStatus()
    }
    if (this.status.state === 'checking' || this.status.state === 'downloading') {
      return this.getStatus()
    }
    this.setStatus({ state: 'checking', progress: null, message: null })
    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      this.fail(error)
    }
    return this.getStatus()
  }

  /** Quits and installs a downloaded update. No-op until one is actually waiting. */
  install(): void {
    if (this.status.state !== 'ready') return
    autoUpdater.quitAndInstall()
  }
}

/** electron-updater's errors are stack-shaped; these are the ones a user can act on. */
export function friendlyUpdateError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  if (/ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|net::/i.test(text)) {
    return 'Could not reach the update server. Check your connection and try again.'
  }
  if (/404|No published versions|Cannot find channel/i.test(text)) {
    return 'No releases published yet.'
  }
  // macOS refuses to swap an app whose signature it cannot verify, which is every
  // unsigned build — worth naming, because nothing the user does here will fix it.
  if (/code signature|Could not get code signature/i.test(text)) {
    return 'This build is unsigned, so macOS will not install updates into it.'
  }
  return text.split('\n')[0]
}
