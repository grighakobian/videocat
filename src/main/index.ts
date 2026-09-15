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
import type { AppSnapshot, ClipboardHit, DiskSpace, EngineStatus, Settings } from '@shared/types'
import { BinaryManager } from './binaries'
import { ClipboardWatcher, isHttpUrl } from './clipboardWatcher'
import { readDiskSpace } from './disk'
import { HistoryFileWatcher } from './fileWatcher'
import { DownloadQueue } from './queue'
import { Store } from './store'
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

let mainWindow: BrowserWindow | null = null
let store: Store
let binaries: BinaryManager
let queue: DownloadQueue
let clipboardWatcher: ClipboardWatcher
let fileWatcher: HistoryFileWatcher
let disk: DiskSpace | null = null
let housekeepingTimer: NodeJS.Timeout | null = null

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

/**
 * Strips the File / Edit / View / Window menus from the bar.
 *
 * macOS always shows an application menu, so that one stays — it carries About, Hide
 * and Quit, and cannot be removed. Everywhere else the menu bar goes entirely.
 *
 * The editing items are folded into that app menu rather than dropped. On macOS a
 * shortcut only fires if some menu item declares it, so removing the Edit menu takes
 * ⌘C/⌘V/⌘X/⌘A with it — and pasting a link into the URL bar is the whole app. Keeping
 * them here leaves the menu bar with a single title while the shortcuts still work.
 * (`visible: false` plus `acceleratorWorksWhenHidden` would hide them and is documented
 * to keep the accelerators, but this way there is nothing to take on trust.)
 */
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
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' }
        ]
      }
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
    engine: binaries.getStatus()
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
    const item = queue.add(trimmed)
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

  ipcMain.handle(IPC.removeHistoryEntry, (_event, id: string) => {
    store.removeHistoryEntry(id)
    publishHistory()
  })

  ipcMain.handle(IPC.clearHistory, () => {
    store.clearHistory()
    publishHistory()
  })

  ipcMain.handle(IPC.readClipboardUrl, async () => {
    const text = (await clipboard.readText()).trim()
    return isHttpUrl(text) ? text : null
  })

  ipcMain.handle(IPC.dismissClipboardHit, (_event, url: string) => clipboardWatcher.ignore(url))

  ipcMain.handle(IPC.updateEngine, () => binaries.updateEngine())

  ipcMain.handle(IPC.openExternal, (_event, url: string) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })
}

function bootstrap(): void {
  binaries = new BinaryManager((status: EngineStatus) => send(IPC.onEngine, status), {
    get: () => store.getLastEngineUpdateCheck(),
    set: (timestamp) => store.setLastEngineUpdateCheck(timestamp)
  }, {
    get: (mtimeMs) => store.getCachedEngineVersion(mtimeMs),
    set: (version, mtimeMs) => store.setCachedEngineVersion(version, mtimeMs)
  })
  const ytdlp = new YtDlp(binaries)

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

  clipboardWatcher = new ClipboardWatcher((hit: ClipboardHit) => send(IPC.onClipboardHit, hit))
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
