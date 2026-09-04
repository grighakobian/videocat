import { useMemo, useState, type JSX } from 'react'
import type { HistoryEntry, MediaKind } from '@shared/types'
import { GridIcon } from '../components/Icons'
import { Thumb } from '../components/Thumb'
import { formatBytes, pluralize } from '../lib/format'

interface LibraryPageProps {
  history: HistoryEntry[]
}

type Filter = 'all' | MediaKind

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'video', label: 'Video' },
  { id: 'audio', label: 'Audio' }
]

export function LibraryPage({ history }: LibraryPageProps): JSX.Element {
  const [filter, setFilter] = useState<Filter>('all')

  // The library only shows media that is still on disk — it is a view of files, not events.
  const available = useMemo(() => history.filter((entry) => entry.fileExists), [history])
  const items = useMemo(
    () => (filter === 'all' ? available : available.filter((entry) => entry.kind === filter)),
    [available, filter]
  )
  const totalBytes = items.reduce((sum, entry) => sum + entry.sizeBytes, 0)

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-head__title">Library</div>
        <div className="page-head__meta">
          {pluralize(items.length, 'item')} · {formatBytes(totalBytes)}
        </div>
        <div className="page-head__end">
          <div className="segmented">
            {FILTERS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                aria-pressed={filter === id}
                onClick={() => setFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="empty">
          <div className="empty__icon">
            <GridIcon size={24} />
          </div>
          <div className="empty__title">
            {available.length === 0 ? 'Your library is empty' : `No ${filter} files`}
          </div>
          <div className="empty__hint">
            Everything you download lands here. Click a tile to play it.
          </div>
        </div>
      ) : (
        <div className="grid">
          {items.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="tile"
              title={entry.outputPath}
              onDoubleClick={() => void window.videocat.revealFile(entry.outputPath)}
              onClick={() => void window.videocat.openFile(entry.outputPath)}
            >
              <Thumb
                kind={entry.kind}
                url={entry.thumbnailUrl}
                durationSeconds={entry.durationSeconds}
              />
              <div className="tile__body">
                <div className="tile__title">{entry.title}</div>
                <div className="tile__meta">
                  <span className="chip">{entry.containerLabel}</span>
                  <span>{formatBytes(entry.sizeBytes)}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
