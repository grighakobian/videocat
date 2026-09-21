import { useState, type JSX } from 'react'
import type { DownloadItem } from '@shared/types'
import { formatBytes, formatDuration, formatTransferred } from '../lib/format'
import { FormatPicker } from './FormatPicker'
import { CloseIcon, PauseIcon, PlayIcon, RetryIcon } from './Icons'
import { Thumb } from './Thumb'

interface DownloadCardProps {
  item: DownloadItem
}

/** Secondary line under the title: quality chips plus size/duration, or a status message. */
function CardMeta({ item }: DownloadCardProps): JSX.Element {
  if (item.status === 'awaiting-format') {
    // Before a quality is chosen there is nothing to chip: what identifies the link is
    // the preview — who published it and how long it is. Formats and sizes come with
    // the picker, which is a click away.
    if (item.stage) return <div className="card__status">{item.stage}</div>
    const preview = [item.uploader, formatDuration(item.durationSeconds)]
      .filter(Boolean)
      .join(' · ')
    return <div className="card__status">{preview || 'Ready · choose a quality to start'}</div>
  }
  const size = item.totalBytes !== null ? formatBytes(item.totalBytes) : null
  return (
    <div className="card__meta">
      {item.qualityLabel ? <span className="chip">{item.qualityLabel}</span> : null}
      {item.containerLabel ? <span className="chip">{item.containerLabel}</span> : null}
      {size ? <span>{size}</span> : null}
      {item.withSubtitles ? <span>· subtitles</span> : null}
    </div>
  )
}

function statusLine(item: DownloadItem): string | null {
  switch (item.status) {
    case 'queued':
      return 'Queued'
    case 'paused':
      return 'Paused'
    case 'failed':
      return null // shown in the error row instead
    default:
      return null
  }
}

export function DownloadCard({ item }: DownloadCardProps): JSX.Element {
  // Opening the quality list is per-card view state, not app state: five rungs with
  // sizes under every waiting card is noise, and the preview above is what tells the
  // user whether this is the video they meant. Cards are keyed by id, so this survives
  // the progress pushes that re-render the list.
  const [choosing, setChoosing] = useState(false)

  // Metadata is still being fetched: the item has no formats yet and its title is the
  // raw URL, which reads as a glitch rather than a title, so show a skeleton instead.
  const resolving = item.status === 'awaiting-format' && item.formats.length === 0
  const resolved = item.status === 'awaiting-format' && item.formats.length > 0
  const showPicker = resolved && choosing
  const isRunning = item.status === 'downloading'
  const showProgress =
    item.status === 'downloading' || item.status === 'paused' || item.status === 'queued'
  const indeterminate = isRunning && item.totalBytes === null && item.progress === 0

  // Bytes, not rate: "412 MB / 1.3 GB" answers "how much of my file is here" and
  // reads the same whether the line is moving or paused, which a speed and an ETA do not.
  const stats = item.stage ?? formatTransferred(item.downloadedBytes, item.totalBytes) ?? ''

  return (
    <div className={resolving ? 'card card--resolving' : 'card'} aria-busy={resolving}>
      <div className="card__body">
        {resolving ? (
          <div className="thumb thumb--skeleton shimmer" />
        ) : (
          <Thumb kind={item.kind} url={item.thumbnailUrl} durationSeconds={item.durationSeconds} />
        )}
        <div className="card__main">
          {resolving ? (
            <div className="card__title card__title--skeleton shimmer" title={item.sourceUrl} />
          ) : (
            <div className="card__title" title={item.title}>
              {item.title}
            </div>
          )}
          <CardMeta item={item} />

          {showProgress ? (
            <div className="progress">
              <div className="progress__track">
                <div
                  className={[
                    'progress__fill',
                    isRunning && !indeterminate ? 'progress__fill--active' : '',
                    indeterminate ? 'progress__fill--indeterminate' : ''
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  style={indeterminate ? undefined : { width: `${Math.round(item.progress * 100)}%` }}
                />
              </div>
              <div className="progress__percent">{Math.round(item.progress * 100)}%</div>
              <div className="progress__stats">{stats || statusLine(item) || ''}</div>
            </div>
          ) : null}

          {item.status === 'failed' && item.error ? (
            <div className="card__error">{item.error}</div>
          ) : null}
        </div>

        <div className="card__actions">
          {resolved && !choosing ? (
            <button
              type="button"
              className="btn btn--sm card__download"
              onClick={() => setChoosing(true)}
            >
              Download
            </button>
          ) : null}
          {item.status === 'downloading' || item.status === 'queued' ? (
            <button
              type="button"
              className="iconbtn"
              aria-label="Pause"
              title="Pause"
              onClick={() => void window.videocat.pause(item.id)}
            >
              <PauseIcon size={13} />
            </button>
          ) : null}
          {item.status === 'paused' ? (
            <button
              type="button"
              className="iconbtn"
              aria-label="Resume"
              title="Resume"
              onClick={() => void window.videocat.resume(item.id)}
            >
              <PlayIcon size={13} />
            </button>
          ) : null}
          {item.status === 'failed' ? (
            <button
              type="button"
              className="iconbtn"
              aria-label="Retry"
              title="Retry"
              onClick={() => void window.videocat.retry(item.id)}
            >
              <RetryIcon size={13} />
            </button>
          ) : null}
          {!showPicker ? (
            <button
              type="button"
              className="iconbtn iconbtn--danger"
              aria-label="Cancel"
              title="Cancel"
              onClick={() => void window.videocat.cancel(item.id)}
            >
              <CloseIcon size={13} />
            </button>
          ) : null}
        </div>
      </div>

      {showPicker ? (
        <FormatPicker
          formats={item.formats}
          withSubtitles={item.withSubtitles}
          dismissLabel="Remove"
          onConfirm={(formatId, withSubtitles) =>
            void window.videocat.chooseFormat(item.id, formatId, withSubtitles)
          }
          onDismiss={() => void window.videocat.cancel(item.id)}
        />
      ) : null}
    </div>
  )
}
