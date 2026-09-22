import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  AppSnapshot,
  ClipboardHit,
  DiskSpace,
  DownloadItem,
  EngineStatus,
  HistoryEntry,
  PageId,
  Settings,
  UpdateStatus
} from '@shared/types'

export interface Toast {
  kind: 'error' | 'info'
  message: string
}

type Unsubscribe = () => void

function subscribe<T>(channel: string, handler: (payload: T) => void): Unsubscribe {
  const listener = (_event: IpcRendererEvent, payload: T): void => handler(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

/**
 * The whole surface the renderer can reach. Everything is an explicit, typed call —
 * the renderer has no Node access and no direct ipcRenderer handle.
 */
const api = {
  getSnapshot: (): Promise<AppSnapshot> => ipcRenderer.invoke(IPC.getSnapshot),
  getVersion: (): Promise<string> => ipcRenderer.invoke(IPC.getVersion),
  getPlatform: (): Promise<{ platform: NodeJS.Platform; customTitlebar: boolean }> =>
    ipcRenderer.invoke(IPC.getPlatform),

  addUrl: (url: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> =>
    ipcRenderer.invoke(IPC.addUrl, url),
  chooseFormat: (id: string, formatId: string, withSubtitles: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC.chooseFormat, id, formatId, withSubtitles),
  setItemSubtitles: (id: string, value: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC.setItemSubtitles, id, value),
  pause: (id: string): Promise<void> => ipcRenderer.invoke(IPC.pause, id),
  resume: (id: string): Promise<void> => ipcRenderer.invoke(IPC.resume, id),
  retry: (id: string): Promise<void> => ipcRenderer.invoke(IPC.retry, id),
  cancel: (id: string): Promise<void> => ipcRenderer.invoke(IPC.cancel, id),
  pauseAll: (): Promise<void> => ipcRenderer.invoke(IPC.pauseAll),
  resumeAll: (): Promise<void> => ipcRenderer.invoke(IPC.resumeAll),

  updateSettings: (patch: Partial<Settings>): Promise<Settings> =>
    ipcRenderer.invoke(IPC.updateSettings, patch),
  chooseDownloadDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC.chooseDownloadDirectory),
  openDownloadFolder: (): Promise<string> => ipcRenderer.invoke(IPC.openDownloadFolder),
  openFile: (path: string): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke(IPC.openFile, path),
  revealFile: (path: string): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke(IPC.revealFile, path),

  /** Both ask for confirmation in a native dialog; the boolean says whether it happened. */
  removeHistoryEntry: (id: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.removeHistoryEntry, id),
  clearHistory: (): Promise<boolean> => ipcRenderer.invoke(IPC.clearHistory),

  readClipboardUrl: (): Promise<string | null> => ipcRenderer.invoke(IPC.readClipboardUrl),
  dismissClipboardHit: (url: string): Promise<void> =>
    ipcRenderer.invoke(IPC.dismissClipboardHit, url),
  updateEngine: (): Promise<EngineStatus> => ipcRenderer.invoke(IPC.updateEngine),
  checkForUpdates: (): Promise<UpdateStatus> => ipcRenderer.invoke(IPC.checkForUpdates),
  /** Quits and relaunches into the downloaded update; nothing happens until one is ready. */
  installUpdate: (): Promise<void> => ipcRenderer.invoke(IPC.installUpdate),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC.openExternal, url),

  onQueue: (handler: (queue: DownloadItem[]) => void): Unsubscribe =>
    subscribe(IPC.onQueue, handler),
  onHistory: (handler: (history: HistoryEntry[]) => void): Unsubscribe =>
    subscribe(IPC.onHistory, handler),
  onSettings: (handler: (settings: Settings) => void): Unsubscribe =>
    subscribe(IPC.onSettings, handler),
  onDisk: (handler: (disk: DiskSpace | null) => void): Unsubscribe => subscribe(IPC.onDisk, handler),
  onEngine: (handler: (engine: EngineStatus) => void): Unsubscribe =>
    subscribe(IPC.onEngine, handler),
  onClipboardHit: (handler: (hit: ClipboardHit) => void): Unsubscribe =>
    subscribe(IPC.onClipboardHit, handler),
  onUpdate: (handler: (status: UpdateStatus) => void): Unsubscribe =>
    subscribe(IPC.onUpdate, handler),
  /** The menu asking the window to show a page — a command, not mirrored state. */
  onNavigate: (handler: (page: PageId) => void): Unsubscribe =>
    subscribe(IPC.onNavigate, handler),
  onToast: (handler: (toast: Toast) => void): Unsubscribe => subscribe(IPC.onToast, handler)
}

export type VideoCatApi = typeof api

contextBridge.exposeInMainWorld('videocat', api)
