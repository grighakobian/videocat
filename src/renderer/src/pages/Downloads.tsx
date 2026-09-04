import { useMemo, type JSX } from 'react'
import type { DownloadItem, HistoryEntry } from '@shared/types'
import { DownloadCard } from '../components/DownloadCard'
import { CheckCircleIcon, DownloadIcon } from '../components/Icons'
import { formatBytes, formatSpeed, isSameDay } from '../lib/format'

interface DownloadsPageProps {
  queue: DownloadItem[]
  history: HistoryEntry[]
}

export function DownloadsPage({ queue, history }: DownloadsPageProps): JSX.Element {
  const active = queue.filter((item) => item.status === 'downloading')
  const totalSpeed = active.reduce((sum, item) => sum + (item.speedBytesPerSecond ?? 0), 0)
  const anythingRunning = queue.some(
    (item) => item.status === 'downloading' || item.status === 'queued'
  )
  const anythingPaused = queue.some((item) => item.status === 'paused')

  const completedToday = useMemo(
    () => history.filter((entry) => isSameDay(entry.completedAt, Date.now())).slice(0, 6),
    [history]
  )

  if (queue.length === 0 && completedToday.length === 0) {
    return (
      <div className="page">
        <div className="empty">
          <div className="empty__icon">
            <DownloadIcon size={24} />
          </div>
          <div className="empty__title">Nothing downloading</div>
          <div className="empty__hint">
            Paste a YouTube link above and hit Download. VideoCat picks your default quality, or use
            Choose quality to decide per video.
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

      {completedToday.length > 0 ? (
        <>
          <div className="page-head" style={{ marginTop: queue.length > 0 ? 8 : 0 }}>
            <div className="page-head__title">Completed today</div>
            <div className="page-head__end">
              <button
                type="button"
                className="linkbtn"
                onClick={() => void window.videocat.openDownloadFolder()}
              >
                Open folder
              </button>
            </div>
          </div>
          {completedToday.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="row"
              title={entry.outputPath}
              onClick={() => void window.videocat.revealFile(entry.outputPath)}
            >
              <span className="row__tick">
                <CheckCircleIcon size={15} />
              </span>
              <span className="row__title">{entry.title}</span>
              <span className="row__meta">
                {entry.qualityLabel} · {formatBytes(entry.sizeBytes)}
              </span>
            </button>
          ))}
        </>
      ) : null}
    </div>
  )
}
