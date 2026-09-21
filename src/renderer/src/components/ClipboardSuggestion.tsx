import type { JSX } from 'react'
import type { ClipboardHit } from '@shared/types'
import { formatDuration } from '../lib/format'
import { FormatPicker } from './FormatPicker'
import { CloseIcon } from './Icons'
import { Thumb } from './Thumb'

interface ClipboardSuggestionProps {
  hit: ClipboardHit
  /** Subtitles default from settings, so an offered link starts like a pasted one. */
  withSubtitles: boolean
  /** A quality was chosen — or, with no formats to choose from, `null` to just queue it. */
  onAccept(formatId: string | null, withSubtitles: boolean): void
  onDismiss(): void
}

/**
 * The offer for a link found on the clipboard. The link was already probed before it was
 * mentioned, so everything the download UI needs is in hand: showing the artwork, the
 * title and the quality rungs here means accepting the suggestion *is* the download —
 * no queueing first and picking a quality after, and nothing starts until a rung is
 * clicked, exactly as for a pasted link.
 *
 * The outer element stays a `.banner`: it is still a notice the app raised on its own,
 * sitting above the queue rather than in it.
 */
export function ClipboardSuggestion({
  hit,
  withSubtitles,
  onAccept,
  onDismiss
}: ClipboardSuggestionProps): JSX.Element {
  const { meta } = hit
  const preview = [meta.uploader, formatDuration(meta.durationSeconds)].filter(Boolean).join(' · ')

  return (
    <div className="banner banner--suggestion">
      <div className="suggestion__head">
        <div className="banner__text">Found on your clipboard</div>
        <button
          type="button"
          className="banner__close"
          aria-label="Dismiss"
          onClick={onDismiss}
        >
          <CloseIcon size={13} />
        </button>
      </div>

      <div className="suggestion__panel">
        <div className="suggestion__body">
          <Thumb kind="video" url={meta.thumbnailUrl} durationSeconds={meta.durationSeconds} />
          <div className="suggestion__main">
            <div className="suggestion__title" title={meta.title}>
              {meta.title}
            </div>
            <div className="suggestion__meta">{preview || meta.sourceUrl}</div>
          </div>
        </div>

        {meta.formats.length > 0 ? (
          <FormatPicker
            formats={meta.formats}
            withSubtitles={withSubtitles}
            dismissLabel="Not now"
            onConfirm={onAccept}
            onDismiss={onDismiss}
          />
        ) : (
          // A probe that found media but no offerable rung (a live stream, say). Queue it
          // and let the card report whatever yt-dlp says, rather than offering nothing.
          <div className="picker">
            <div className="picker__confirm">
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => onAccept(null, withSubtitles)}
              >
                Add to downloads
              </button>
              <button type="button" className="linkbtn linkbtn--muted" onClick={onDismiss}>
                Not now
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
