import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { PageId } from '@shared/types'
import { Sidebar } from './components/Sidebar'
import { UrlBar } from './components/UrlBar'
import { useVideoCat } from './lib/useVideoCat'
import { CompletedPage } from './pages/Completed'
import { DownloadsPage } from './pages/Downloads'
import { LibraryPage } from './pages/Library'
import { SettingsPage } from './pages/Settings'
import { CloseIcon } from './components/Icons'

const PAGE_TITLES: Record<PageId, string> = {
  downloads: 'Downloads',
  completed: 'Completed',
  library: 'Library',
  settings: 'Settings'
}

export default function App(): JSX.Element {
  const state = useVideoCat()
  const [page, setPage] = useState<PageId>('downloads')
  const [url, setUrl] = useState('')
  const [customTitlebar, setCustomTitlebar] = useState(true)
  const urlInputRef = useRef<HTMLInputElement>(null)

  const { settings, engine, showToast } = state

  useEffect(() => {
    if (settings) document.documentElement.style.setProperty('--accent', settings.accentColor)
  }, [settings?.accentColor])

  useEffect(() => {
    document.title = `VideoCat — ${PAGE_TITLES[page]}`
  }, [page])

  // Platforms where we kept the native frame draw their own titlebar; don't double up.
  useEffect(() => {
    void window.videocat.getPlatform().then((info) => setCustomTitlebar(info.customTitlebar))
  }, [])

  const activeCount = useMemo(
    () => state.queue.filter((item) => item.status !== 'completed').length,
    [state.queue]
  )

  const submit = useCallback(
    async (candidate: string) => {
      const trimmed = candidate.trim()
      if (!trimmed) return
      if (engine.state === 'error') {
        showToast({ kind: 'error', message: engine.message ?? 'The download engine is unavailable.' })
        return
      }
      const result = await window.videocat.addUrl(trimmed)
      if (!result.ok) {
        showToast({ kind: 'error', message: result.error })
        return
      }
      setUrl('')
      setPage('downloads')
    },
    [engine.state, engine.message, showToast]
  )

  // ⌘V / Ctrl+V anywhere outside a text field pastes a link straight into the bar.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      const inField = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA'
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v' && !inField) {
        event.preventDefault()
        void window.videocat.readClipboardUrl().then((clipboardUrl) => {
          if (!clipboardUrl) {
            showToast({ kind: 'error', message: 'No link on the clipboard.' })
            return
          }
          setUrl(clipboardUrl)
          urlInputRef.current?.focus()
        })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [showToast])

  const engineBusy = engine.state === 'checking' || engine.state === 'downloading'

  return (
    <div className="app">
      {customTitlebar ? (
        <div className="titlebar">
          <span className="titlebar__label">VideoCat — {PAGE_TITLES[page]}</span>
        </div>
      ) : null}
      <div className="shell">
        <Sidebar page={page} onNavigate={setPage} activeCount={activeCount} disk={state.disk} />
        <div className="main">
          <UrlBar
            ref={urlInputRef}
            value={url}
            onChange={setUrl}
            onSubmit={() => void submit(url)}
            disabled={engineBusy}
          />

          {engine.state === 'downloading' ? (
            <div className="banner">
              <div className="banner__text">
                {engine.message ?? 'Setting up the download engine…'}
                {engine.progress !== null ? ` ${Math.round(engine.progress * 100)}%` : ''}
              </div>
            </div>
          ) : null}

          {engine.state === 'error' ? (
            <div className="banner banner--error">
              <div className="banner__text">Download engine unavailable — {engine.message}</div>
              <button
                type="button"
                className="linkbtn"
                onClick={() => void window.videocat.updateEngine()}
              >
                Retry
              </button>
            </div>
          ) : null}

          {page === 'downloads' && state.clipboardHit ? (
            <div className="banner">
              <div className="banner__text">
                Link detected in clipboard —{' '}
                <a
                  onClick={() => {
                    const hit = state.clipboardHit
                    state.dismissClipboardHit()
                    if (hit) void submit(hit.url)
                  }}
                >
                  download it?
                </a>
              </div>
              <button
                type="button"
                className="banner__close"
                aria-label="Dismiss"
                onClick={state.dismissClipboardHit}
              >
                <CloseIcon size={13} />
              </button>
            </div>
          ) : null}

          {page === 'downloads' ? (
            <DownloadsPage queue={state.queue} history={state.history} />
          ) : null}
          {page === 'completed' ? <CompletedPage history={state.history} /> : null}
          {page === 'library' ? <LibraryPage history={state.history} /> : null}
          {page === 'settings' && settings ? (
            <SettingsPage settings={settings} engine={engine} />
          ) : null}
        </div>
      </div>

      {state.toast ? (
        <div className={`toast${state.toast.kind === 'error' ? ' toast--error' : ''}`}>
          <span>{state.toast.message}</span>
          <button
            type="button"
            className="banner__close"
            aria-label="Dismiss"
            onClick={state.dismissToast}
          >
            <CloseIcon size={13} />
          </button>
        </div>
      ) : null}
    </div>
  )
}
