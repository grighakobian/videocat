import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  Notification,
  shell
} from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { IPC } from '@shared/ipc'
import type {
  AppSnapshot,
  ClipboardHit,
  DiskSpace,
  EngineStatus,
  Settings,
  UpdateStatus,
  VideoMeta
} from '@shared/types'
import { BinaryManager } from './binaries'
import { ClipboardWatcher, isHttpUrl } from './clipboardWatcher'
import { readDiskSpace } from './disk'
import { HistoryFileWatcher } from './fileWatcher'
import { DownloadQueue } from './queue'
import { Store } from './store'
import { AppUpdater } from './updater'
import { YtDlp } from './ytdlp'

/**
 * Cadence of the housekeeping tick: disk space, plus a re-stat of history as a fallback
 * for the file watcher (network volumes and some editors' save-by-replace can slip past
 * `fs.watch`; a periodic check keeps the display honest either way).
 */
const HOUSEKEEPING_INTERVAL_MS = 30_000

/** Must match the `.titlebar` height in the renderer stylesheet. */
const TITLEBAR_HEIGHT = 46

/** True when we hid the OS frame, so the renderer should draw its own titlebar. */
const USES_CUSTOM_TITLEBAR = process.platform === 'darwin' || process.platform === 'win32'

/**
 * How long a resolved clipboard link is worth reusing. Past that the picker would be
 * quoting sizes from a probe the user has long forgotten, so add it afresh instead.
 */
const CLIPBOARD_OFFER_TTL_MS = 10 * 60_000

let mainWindow: BrowserWindow | null = null
let store: Store
let binaries: BinaryManager
let ytdlp: YtDlp
let queue: DownloadQueue
let clipboardWatcher: ClipboardWatcher
let updater: AppUpdater
let fileWatcher: HistoryFileWatcher
let disk: DiskSpace | null = null
let housekeepingTimer: NodeJS.Timeout | null = null
/** Clipboard link waiting to be resolved: copied while a probe ran, or before the engine was ready. */
let pendingClipboardUrl: string | null = null
let resolvingClipboard = false
/** The last clipboard link that resolved, kept so adding it does not re-probe the same URL. */
let clipboardOffer: { url: string; meta: VideoMeta; at: number } | null = null
/** The suggestion the banner is showing, mirrored into the snapshot like every other state. */
let clipboardHit: ClipboardHit | null = null

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

/**
 * Keeps the two menus macOS expects — the application menu and Edit — and drops the
 * rest: File, View and Window carry nothing this app can do. Everywhere else the menu
 * bar goes entirely.
 *
 * Edit has to exist at all because on macOS a shortcut only fires if some menu item
 * declares it: remove Edit and ⌘C/⌘V/⌘X/⌘A go with it, and pasting a link into the URL
 * bar is the whole app. These items were folded into the application menu to keep the
 * bar to a single title, which kept the shortcuts but left Cut and Paste in the one
 * menu nobody looks for them in. `role: 'editMenu'` is the arrangement macOS defines,
 * and it brings Paste and Match Style, Speech and Emoji along with it.
 */
/**
 * The Settings menu item. On macOS the app outlives its window, so the item has to be
 * able to put one back before it can ask the renderer to show a page.
 */
function openSettings(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    mainWindow?.webContents.once('did-finish-load', () => send(IPC.onNavigate, 'settings'))
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  send(IPC.onNavigate, 'settings')
}

function applyMenu(): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          // Where macOS keeps it, under the name macOS 13 gave it, on the shortcut every
          // Mac app answers to. There is no Electron role for this one.
          { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => openSettings() },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' }
        ]
      },
      { role: 'editMenu' }
    ])
  )
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 880,
    minHeight: 560,
    show: false,
    backgroundColor: '#FCFCFB',
    // Drop the OS chrome but keep the window controls, so the app draws the titlebar
    // from the design on both platforms: traffic lights on macOS, an overlay on Windows.
    // Anywhere else, fall back to a native frame (and the renderer hides its own bar).
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 17 } }
      : process.platform === 'win32'
        ? {
            titleBarStyle: 'hidden' as const,
            titleBarOverlay: { color: '#F7F6F3', symbolColor: '#57524A', height: TITLEBAR_HEIGHT }
          }
        : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function buildSnapshot(): AppSnapshot {
  return {
    settings: store.getSettings(),
    queue: queue.list(),
    // Re-stat here rather than trusting a startup pass; files move while the app runs.
    history: store.refreshFileExistence().history,
    disk,
    engine: binaries.getStatus(),
    clipboardHit,
    update: updater.getStatus()
  }
}

async function refreshDisk(): Promise<void> {
  disk = await readDiskSpace(store.getSettings().downloadDirectory)
  send(IPC.onDisk, disk)
}

/** Re-checks which finished files are still on disk and pushes history only if any flipped. */
function refreshHistoryFiles(): void {
  const { history, changed } = store.refreshFileExistence()
  if (changed) send(IPC.onHistory, history)
}

/** Points the file watcher at the folders the current history entries live in. */
function syncFileWatcher(): void {
  fileWatcher.sync(store.getHistory().map((entry) => entry.outputPath))
}

/** History changed in the store: tell the renderer and re-aim the watcher. */
function publishHistory(): void {
  send(IPC.onHistory, store.getHistory())
  syncFileWatcher()
}

function housekeeping(): void {
  void refreshDisk()
  refreshHistoryFiles()
  // Also re-attempts folders that could not be watched earlier (e.g. an unmounted drive).
  syncFileWatcher()
}

/** A link appeared on the clipboard: queue it up to be resolved. */
function considerClipboardLink(url: string): void {
  pendingClipboardUrl = url
  void resolveClipboardLink()
}

/**
 * Probes a copied link and only mentions it once yt-dlp says it is media, so the banner
 * can name what it found instead of asking about every URL that passes through the
 * clipboard. A link that does not resolve is never mentioned at all, and is ignored so
 * re-copying it costs no second probe — pasting it into the URL bar still surfaces the
 * real error. The resolved metadata is kept so accepting the suggestion opens the
 * picker without probing the same URL twice.
 */
async function resolveClipboardLink(): Promise<void> {
  // One probe at a time; the tail of this function picks up anything copied meanwhile.
  if (resolvingClipboard) return
  const url = pendingClipboardUrl
  if (!url) return
  // Probing is a yt-dlp run. On a cold start the engine is still unpacking, so hold the
  // link — the engine-ready callback comes back here rather than failing it now.
  if (binaries.getStatus().state !== 'ready') return

  resolvingClipboard = true
  try {
    const meta = await ytdlp.probe(url)
    if (pendingClipboardUrl !== url) return // superseded by a newer copy
    pendingClipboardUrl = null
    clipboardOffer = { url, meta, at: Date.now() }
    // The whole probe result goes to the renderer: the offer shows the picker, so it
    // needs the formats, not just a title.
    clipboardHit = { url, meta }
    send(IPC.onClipboardHit, clipboardHit)
  } catch {
    // Not media, or unreachable. Staying quiet is the point of resolving first.
    if (pendingClipboardUrl === url) pendingClipboardUrl = null
    clipboardWatcher.ignore(url)
  } finally {
    resolvingClipboard = false
    if (pendingClipboardUrl) void resolveClipboardLink()
  }
}

/** Metadata already probed for this exact URL, if it is recent enough to still be true. */
function takeClipboardOffer(url: string): VideoMeta | undefined {
  if (clipboardHit?.url === url) clipboardHit = null
  if (!clipboardOffer || clipboardOffer.url !== url) return undefined
  const { meta, at } = clipboardOffer
  clipboardOffer = null
  return Date.now() - at <= CLIPBOARD_OFFER_TTL_MS ? meta : undefined
}

/**
 * A native, window-modal confirmation (a sheet on macOS). Forgetting a download is not
 * undoable and the list is the only record of it, so the OS asks rather than the page:
 * a system dialog cannot be missed the way an in-page banner can, and it is the same
 * prompt every other app on the machine uses to ask this.
 */
async function confirmDestructive(
  message: string,
  detail: string,
  confirmLabel: string
): Promise<boolean> {
  const options = {
    type: 'warning' as const,
    buttons: [confirmLabel, 'Cancel'],
    // Cancel is both the default and the escape: the confirming button is destructive, so
    // it must not be the one that fires on Return, and someone dismissing the sheet
    // without reading it keeps their download. (Electron's dialog API has no per-button
    // style — macOS's own `hasDestructiveAction` is not exposed — so the red button a
    // native app would paint is not available here; withholding the default is.)
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    message,
    detail
  }
  const { response } = mainWindow
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options)
  return response === 0
}

function applyClipboardSetting(settings: Settings): void {
  if (settings.watchClipboard) clipboardWatcher.start()
  else clipboardWatcher.stop()
}

function registerIpc(): void {
  ipcMain.handle(IPC.getSnapshot, () => buildSnapshot())
  ipcMain.handle(IPC.getVersion, () => app.getVersion())
  ipcMain.handle(IPC.getPlatform, () => ({
    platform: process.platform,
    customTitlebar: USES_CUSTOM_TITLEBAR
  }))

  ipcMain.handle(IPC.addUrl, (_event, url: string) => {
    const trimmed = String(url ?? '').trim()
    // No host check: yt-dlp decides what it can extract, and says so if it cannot.
    if (!isHttpUrl(trimmed)) {
      return { ok: false as const, error: 'That does not look like a link. Paste a video URL.' }
    }
    clipboardWatcher.ignore(trimmed)
    const item = queue.add(trimmed, takeClipboardOffer(trimmed))
    return { ok: true as const, id: item.id }
  })

  ipcMain.handle(IPC.chooseFormat, (_event, id: string, formatId: string, withSubtitles: boolean) => {
    queue.chooseFormat(id, formatId, withSubtitles)
  })
  ipcMain.handle(IPC.setItemSubtitles, (_event, id: string, value: boolean) =>
    queue.setSubtitles(id, value)
  )
  ipcMain.handle(IPC.pause, (_event, id: string) => queue.pause(id))
  ipcMain.handle(IPC.resume, (_event, id: string) => queue.resume(id))
  ipcMain.handle(IPC.retry, (_event, id: string) => queue.retry(id))
  ipcMain.handle(IPC.cancel, (_event, id: string) => queue.cancel(id))
  ipcMain.handle(IPC.pauseAll, () => queue.pauseAll())
  ipcMain.handle(IPC.resumeAll, () => queue.resumeAll())

  ipcMain.handle(IPC.updateSettings, async (_event, patch: Partial<Settings>) => {
    const settings = store.updateSettings(patch)
    queue.onSettingsChanged(settings)
    applyClipboardSetting(settings)
    send(IPC.onSettings, settings)
    if (patch.downloadDirectory) await refreshDisk()
    return settings
  })

  ipcMain.handle(IPC.chooseDownloadDirectory, async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose where VideoCat saves downloads',
      defaultPath: store.getSettings().downloadDirectory,
      properties: ['openDirectory', 'createDirectory']
    })
    const directory = result.filePaths[0]
    if (result.canceled || !directory) return null
    const settings = store.updateSettings({ downloadDirectory: directory })
    send(IPC.onSettings, settings)
    await refreshDisk()
    return directory
  })

  ipcMain.handle(IPC.openDownloadFolder, () => shell.openPath(store.getSettings().downloadDirectory))

  ipcMain.handle(IPC.openFile, async (_event, path: string) => {
    if (!existsSync(path)) return { ok: false as const, error: 'That file is no longer on disk.' }
    const error = await shell.openPath(path)
    return error ? { ok: false as const, error } : { ok: true as const }
  })

  ipcMain.handle(IPC.revealFile, (_event, path: string) => {
    if (!existsSync(path)) return { ok: false as const, error: 'That file is no longer on disk.' }
    shell.showItemInFolder(path)
    return { ok: true as const }
  })

  ipcMain.handle(IPC.removeHistoryEntry, async (_event, id: string) => {
    const entry = store.getHistory().find((item) => item.id === id)
    if (!entry) return false
    // Removing forgets the download; it never touches the file. Say so, or the dialog
    // reads like it is about to delete the video.
    const confirmed = await confirmDestructive(
      'Remove this download from the list?',
      `“${entry.title}” stops being listed here. The file itself stays on disk.`,
      'Remove'
    )
    if (!confirmed) return false
    store.removeHistoryEntry(id)
    publishHistory()
    return true
  })

  ipcMain.handle(IPC.clearHistory, async () => {
    const count = store.getHistory().length
    if (count === 0) return false
    const confirmed = await confirmDestructive(
      'Clear the list of finished downloads?',
      count === 1
        ? 'The one download listed here stops being listed. The file itself stays on disk.'
        : `All ${count} downloads stop being listed here. The files themselves stay on disk.`,
      'Clear history'
    )
    if (!confirmed) return false
    store.clearHistory()
    publishHistory()
    return true
  })

  ipcMain.handle(IPC.readClipboardUrl, async () => {
    const text = (await clipboard.readText()).trim()
    return isHttpUrl(text) ? text : null
  })

  ipcMain.handle(IPC.dismissClipboardHit, (_event, url: string) => {
    if (clipboardHit?.url === url) clipboardHit = null
    // The probed metadata stays: pasting the link later should still skip the probe.
    clipboardWatcher.ignore(url)
  })

  ipcMain.handle(IPC.updateEngine, () => binaries.updateEngine())
  ipcMain.handle(IPC.checkForUpdates, () => updater.check())
  ipcMain.handle(IPC.installUpdate, () => updater.install())

  ipcMain.handle(IPC.openExternal, (_event, url: string) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })
}

function bootstrap(): void {
  binaries = new BinaryManager((status: EngineStatus) => {
    send(IPC.onEngine, status)
    // A link copied before the engine finished provisioning is still waiting to be probed.
    if (status.state === 'ready') void resolveClipboardLink()
  }, {
    get: () => store.getLastEngineUpdateCheck(),
    set: (timestamp) => store.setLastEngineUpdateCheck(timestamp)
  }, {
    get: (mtimeMs) => store.getCachedEngineVersion(mtimeMs),
    set: (version, mtimeMs) => store.setCachedEngineVersion(version, mtimeMs)
  })
  ytdlp = new YtDlp(binaries)

  queue = new DownloadQueue(ytdlp, store, {
    onChange: () => send(IPC.onQueue, queue.list()),
    onCompleted: (entry) => {
      publishHistory()
      void refreshDisk()
      if (store.getSettings().notifyOnComplete && Notification.isSupported()) {
        const notification = new Notification({
          title: 'Download complete',
          body: entry.title
        })
        notification.on('click', () => shell.showItemInFolder(entry.outputPath))
        notification.show()
      }
    },
    onFailed: (item) => send(IPC.onToast, { kind: 'error', message: item.error ?? 'Download failed.' })
  })

  updater = new AppUpdater((status: UpdateStatus) => send(IPC.onUpdate, status))
  clipboardWatcher = new ClipboardWatcher(considerClipboardLink)
  fileWatcher = new HistoryFileWatcher(refreshHistoryFiles)
}

app.whenReady().then(async () => {
  store = new Store()
  bootstrap()
  registerIpc()
  applyMenu()
  createWindow()

  applyClipboardSetting(store.getSettings())
  syncFileWatcher()
  await refreshDisk()
  housekeepingTimer = setInterval(housekeeping, HOUSEKEEPING_INTERVAL_MS)
  void binaries.ensureReady()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (housekeepingTimer) clearInterval(housekeepingTimer)
  clipboardWatcher?.stop()
  fileWatcher?.stop()
  queue?.shutdown()
})
