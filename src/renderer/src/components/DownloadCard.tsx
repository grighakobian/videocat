import { useEffect, useState, type JSX } from 'react'
import type { DownloadItem } from '@shared/types'
import { formatBytes, formatEta, formatSpeed } from '../lib/format'
import { CloseIcon, PauseIcon, PlayIcon, RetryIcon } from './Icons'
import { Thumb } from './Thumb'

interface DownloadCardProps {
  item: DownloadItem
}

/** Secondary line under the title: quality chips plus size/duration, or a status message. */
function CardMeta({ item }: DownloadCardProps): JSX.Element {
  if (item.status === 'awaiting-format') {
    return <div className="card__status">{item.stage ?? 'Waiting · pick a format to start'}</div>
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

/** The format picker shown while an item is waiting on a quality choice. */
function FormatPicker({ item }: DownloadCardProps): JSX.Element {
  const [selected, setSelected] = useState<string | null>(null)
  const [subtitles, setSubtitles] = useState(item.withSubtitles)

  // Default the highlight to the first (highest) option once formats arrive.
  useEffect(() => {
    if (!selected && item.formats.length > 0) setSelected(item.formats[0].id)
  }, [item.formats, selected])

  const choice = item.formats.find((format) => format.id === selected) ?? null

  return (
    <div className="picker">
      <div className="section-label">Choose quality</div>
      <div className="picker__options">
        {item.formats.map((format) => (
          <button
            key={format.id}
            type="button"
            className={`option${selected === format.id ? ' option--selected' : ''}`}
            onClick={() => setSelected(format.id)}
          >
            <div className="option__label">{format.label}</div>
            <div className="option__detail">{format.detail}</div>
          </button>
        ))}
        <label className="checkline">
          <input
            type="checkbox"
            checked={subtitles}
            disabled={choice?.kind === 'audio'}
            onChange={(event) => setSubtitles(event.target.checked)}
          />
          Subtitles (.srt)
        </label>
      </div>
      {choice && !choice.widelyCompatible ? (
        <div className="picker__note">
          {choice.label.split(' · ')[0]} is only published as {choice.codecLabel} at this
          resolution. QuickTime cannot play it — use VLC or IINA, or pick a lower quality for
          a file that plays anywhere.
        </div>
      ) : null}
      <div className="picker__confirm">
        <button
          type="button"
          className="btn btn--sm"
          disabled={!choice}
          onClick={() => {
            if (choice) void window.videocat.chooseFormat(item.id, choice.id, subtitles)
          }}
        >
          Start download
        </button>
        <button
          type="button"
          className="linkbtn linkbtn--muted"
          onClick={() => void window.videocat.cancel(item.id)}
        >
          Remove
        </button>
      </div>
    </div>
  )
}

export function DownloadCard({ item }: DownloadCardProps): JSX.Element {
  const showPicker = item.status === 'awaiting-format' && item.formats.length > 0
  const isRunning = item.status === 'downloading'
  const showProgress =
    item.status === 'downloading' || item.status === 'paused' || item.status === 'queued'
  const indeterminate = isRunning && item.totalBytes === null && item.progress === 0

  const speed = formatSpeed(item.speedBytesPerSecond)
  const eta = formatEta(item.etaSeconds)
  const stats = item.stage ?? [speed, eta].filter(Boolean).join(' · ')

  return (
    <div className="card">
      <div className="card__body">
        <Thumb kind={item.kind} url={item.thumbnailUrl} durationSeconds={item.durationSeconds} />
        <div className="card__main">
          <div className="card__title" title={item.title}>
            {item.title}
          </div>
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

      {showPicker ? <FormatPicker item={item} /> : null}
    </div>
  )
}
