import { useMemo, type JSX } from 'react'
import type { HistoryEntry } from '@shared/types'
import { CheckCircleIcon } from '../components/Icons'
import { Thumb } from '../components/Thumb'
import { formatBytes, formatTimeOfDay, groupByDay, pluralize } from '../lib/format'

interface CompletedPageProps {
  history: HistoryEntry[]
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export function CompletedPage({ history }: CompletedPageProps): JSX.Element {
  const groups = useMemo(() => groupByDay(history), [history])
  const weekBytes = useMemo(
    () =>
      history
        .filter((entry) => Date.now() - entry.completedAt < WEEK_MS)
        .reduce((sum, entry) => sum + entry.sizeBytes, 0),
    [history]
  )

  if (history.length === 0) {
    return (
      <div className="page">
        <div className="empty">
          <div className="empty__icon">
            <CheckCircleIcon size={24} />
          </div>
          <div className="empty__title">No downloads yet</div>
          <div className="empty__hint">Finished downloads show up here, grouped by day.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-head__title">Completed</div>
        <div className="page-head__meta">
          {pluralize(history.length, 'file')} · {formatBytes(weekBytes)} this week
        </div>
        <div className="page-head__end">
          <button type="button" className="linkbtn" onClick={() => void window.videocat.clearHistory()}>
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
                  <span>
                    {formatBytes(entry.sizeBytes)}
                    {entry.fileExists
                      ? ` · finished ${formatTimeOfDay(entry.completedAt)}`
                      : ' · file moved or deleted'}
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
    </div>
  )
}
