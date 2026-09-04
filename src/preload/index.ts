import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  AppSnapshot,
  ClipboardHit,
  DiskSpace,
  DownloadItem,
  EngineStatus,
  HistoryEntry,
  Settings
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

  addUrl: (
    url: string,
    autoStart: boolean
  ): Promise<{ ok: true; id: string } | { ok: false; error: string }> =>
    ipcRenderer.invoke(IPC.addUrl, url, autoStart),
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

  removeHistoryEntry: (id: string): Promise<void> => ipcRenderer.invoke(IPC.removeHistoryEntry, id),
  clearHistory: (): Promise<void> => ipcRenderer.invoke(IPC.clearHistory),

  readClipboardUrl: (): Promise<string | null> => ipcRenderer.invoke(IPC.readClipboardUrl),
  dismissClipboardHit: (url: string): Promise<void> =>
    ipcRenderer.invoke(IPC.dismissClipboardHit, url),
  updateEngine: (): Promise<EngineStatus> => ipcRenderer.invoke(IPC.updateEngine),
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
  onToast: (handler: (toast: Toast) => void): Unsubscribe => subscribe(IPC.onToast, handler)
}

export type VideoCatApi = typeof api

contextBridge.exposeInMainWorld('videocat', api)
