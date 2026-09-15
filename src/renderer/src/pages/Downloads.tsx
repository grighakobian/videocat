import { useMemo, type JSX } from 'react'
import type { DownloadItem, HistoryEntry } from '@shared/types'
import { DownloadCard } from '../components/DownloadCard'
import { AlertCircleIcon, CheckCircleIcon, DownloadIcon } from '../components/Icons'
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
            Paste a video link above and hit Download. VideoCat fetches the details and asks
            which quality you want.
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
              className={`row${entry.fileExists ? '' : ' row--missing'}`}
              title={entry.fileExists ? entry.outputPath : `${entry.outputPath} — moved or deleted`}
              // A missing file has nothing to reveal; the row stays for the record.
              disabled={!entry.fileExists}
              onClick={() => void window.videocat.revealFile(entry.outputPath)}
            >
              <span className="row__tick">
                {entry.fileExists ? <CheckCircleIcon size={15} /> : <AlertCircleIcon size={15} />}
              </span>
              <span className="row__title">{entry.title}</span>
              <span className="row__meta">
                {entry.fileExists
                  ? `${entry.qualityLabel} · ${formatBytes(entry.sizeBytes)}`
                  : 'moved or deleted'}
              </span>
            </button>
          ))}
        </>
      ) : null}
    </div>
  )
}
