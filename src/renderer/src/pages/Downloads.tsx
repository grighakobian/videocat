import { useMemo, type JSX } from 'react'
import type { DownloadItem, HistoryEntry } from '@shared/types'
import { DownloadCard } from '../components/DownloadCard'
import { AlertCircleIcon, DownloadIcon } from '../components/Icons'
import { Thumb } from '../components/Thumb'
import { formatBytes, formatSpeed, formatTimeOfDay, groupByDay, pluralize } from '../lib/format'

interface DownloadsPageProps {
  queue: DownloadItem[]
  history: HistoryEntry[]
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export function DownloadsPage({ queue, history }: DownloadsPageProps): JSX.Element {
  const active = queue.filter((item) => item.status === 'downloading')
  const totalSpeed = active.reduce((sum, item) => sum + (item.speedBytesPerSecond ?? 0), 0)
  const anythingRunning = queue.some(
    (item) => item.status === 'downloading' || item.status === 'queued'
  )
  const anythingPaused = queue.some((item) => item.status === 'paused')

  // A completed item is deleted from the queue and becomes history, so what finished
  // sits below what is still running: the whole life of a download on one screen.
  const groups = useMemo(() => groupByDay(history), [history])
  const weekBytes = useMemo(
    () =>
      history
        .filter((entry) => Date.now() - entry.completedAt < WEEK_MS)
        .reduce((sum, entry) => sum + entry.sizeBytes, 0),
    [history]
  )

  if (queue.length === 0 && history.length === 0) {
    return (
      <div className="page">
        <div className="empty">
          <div className="empty__icon">
            <DownloadIcon size={24} />
          </div>
          <div className="empty__title">Nothing downloading</div>
          <div className="empty__hint">
            Paste a video link above and hit Download. VideoCat fetches the details and asks
            which quality you want. Finished files stay here, grouped by day.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      {queue.length > 0 ? (
        <>
          <div className="page-head">
            <div className="page-head__title">Downloading</div>
            <div className="page-head__meta">
              {active.length} active
              {totalSpeed > 0 ? ` · ${formatSpeed(totalSpeed)} total` : ''}
            </div>
            <div className="page-head__end">
              {anythingRunning ? (
                <button
                  type="button"
                  className="linkbtn"
                  onClick={() => void window.videocat.pauseAll()}
                >
                  Pause all
                </button>
              ) : null}
              {!anythingRunning && anythingPaused ? (
                <button
                  type="button"
                  className="linkbtn"
                  onClick={() => void window.videocat.resumeAll()}
                >
                  Resume all
                </button>
              ) : null}
            </div>
          </div>

          {queue.map((item) => (
            <DownloadCard key={item.id} item={item} />
          ))}
        </>
      ) : null}

      {history.length > 0 ? (
        <>
          <div className="page-head" style={{ marginTop: queue.length > 0 ? 8 : 0 }}>
            <div className="page-head__title">Completed</div>
            <div className="page-head__meta">
              {pluralize(history.length, 'file')} · {formatBytes(weekBytes)} this week
            </div>
            <div className="page-head__end">
              <button
                type="button"
                className="linkbtn"
                onClick={() => void window.videocat.openDownloadFolder()}
              >
                Open folder
              </button>
              <button
                type="button"
                className="linkbtn"
                onClick={() => void window.videocat.clearHistory()}
              >
                Clear history
              </button>
            </div>
          </div>

          {groups.map((group) => (
            <div key={group.label} style={{ display: 'contents' }}>
              <div className="day-label">{group.label}</div>
              {group.items.map((entry) => (
                <div
                  key={entry.id}
                  className={`history-item${entry.fileExists ? '' : ' history-item--missing'}`}
                >
                  <Thumb kind={entry.kind} url={entry.thumbnailUrl} />
                  <div className="card__main">
                    <div className="card__title" title={entry.title}>
                      {entry.title}
                    </div>
                    <div className="card__meta">
                      <span className="chip">{entry.qualityLabel}</span>
                      <span className="chip">{entry.containerLabel}</span>
                      {entry.fileExists ? null : (
                        <span className="chip chip--missing" title={entry.outputPath}>
                          <AlertCircleIcon size={12} />
                          Missing from disk
                        </span>
                      )}
                      <span>
                        {formatBytes(entry.sizeBytes)}
                        {entry.fileExists
                          ? ` · finished ${formatTimeOfDay(entry.completedAt)}`
                          : ' · the file was moved or deleted'}
                      </span>
                    </div>
                  </div>
                  <div className="card__actions" style={{ alignItems: 'center' }}>
                    <button
                      type="button"
                      className="btn btn--sm"
                      disabled={!entry.fileExists}
                      onClick={() => void window.videocat.openFile(entry.outputPath)}
                    >
                      Play
                    </button>
                    <button
                      type="button"
                      className="btn btn--sm btn--ghost"
                      disabled={!entry.fileExists}
                      onClick={() => void window.videocat.revealFile(entry.outputPath)}
                    >
                      {navigator.platform.toLowerCase().includes('mac')
                        ? 'Show in Finder'
                        : 'Show in Explorer'}
                    </button>
                    <button
                      type="button"
                      className="btn btn--sm btn--ghost"
                      onClick={() => void window.videocat.removeHistoryEntry(entry.id)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </>
      ) : null}
    </div>
  )
}
