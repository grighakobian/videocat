import { useCallback, useEffect, useState } from 'react'
import type {
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

export interface GrabbitState {
  ready: boolean
  settings: Settings | null
  queue: DownloadItem[]
  history: HistoryEntry[]
  disk: DiskSpace | null
  engine: EngineStatus
  clipboardHit: ClipboardHit | null
  toast: Toast | null
  dismissClipboardHit(): void
  showToast(toast: Toast): void
  dismissToast(): void
}

const INITIAL_ENGINE: EngineStatus = {
  state: 'checking',
  version: null,
  message: null,
  progress: null
}

/**
 * Single source of truth for the renderer. The main process owns all real state and
 * pushes it here; this hook only mirrors it and never mutates it locally.
 */
export function useGrabbit(): GrabbitState {
  const [ready, setReady] = useState(false)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [queue, setQueue] = useState<DownloadItem[]>([])
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [disk, setDisk] = useState<DiskSpace | null>(null)
  const [engine, setEngine] = useState<EngineStatus>(INITIAL_ENGINE)
  const [clipboardHit, setClipboardHit] = useState<ClipboardHit | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)

  useEffect(() => {
    let canceled = false
    void window.grabbit.getSnapshot().then((snapshot) => {
      if (canceled) return
      setSettings(snapshot.settings)
      setQueue(snapshot.queue)
      setHistory(snapshot.history)
      setDisk(snapshot.disk)
      setEngine(snapshot.engine)
      setReady(true)
    })

    const unsubscribers = [
      window.grabbit.onQueue(setQueue),
      window.grabbit.onHistory(setHistory),
      window.grabbit.onSettings(setSettings),
      window.grabbit.onDisk(setDisk),
      window.grabbit.onEngine(setEngine),
      window.grabbit.onClipboardHit(setClipboardHit),
      window.grabbit.onToast(setToast)
    ]

    return () => {
      canceled = true
      for (const unsubscribe of unsubscribers) unsubscribe()
    }
  }, [])

  // Toasts are transient; clear them on a timer rather than making the user dismiss.
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(timer)
  }, [toast])

  const dismissClipboardHit = useCallback(() => {
    setClipboardHit((current) => {
      if (current) void window.grabbit.dismissClipboardHit(current.url)
      return null
    })
  }, [])

  return {
    ready,
    settings,
    queue,
    history,
    disk,
    engine,
    clipboardHit,
    toast,
    dismissClipboardHit,
    showToast: setToast,
    dismissToast: () => setToast(null)
  }
}
