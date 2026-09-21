import { useEffect, useState, type JSX } from 'react'
import type { FormatChoice } from '@shared/types'

interface FormatPickerProps {
  formats: FormatChoice[]
  /** Initial state of the subtitles box: the item's own choice, or the setting's default. */
  withSubtitles: boolean
  /** Wording for the way out — "Remove" for a queued card, "Not now" for an offer. */
  dismissLabel: string
  onConfirm(formatId: string, withSubtitles: boolean): void
  onDismiss(): void
}

/**
 * The quality list. Shared by a queued card and the clipboard suggestion, so a link the
 * app offers is started through exactly the same UI as one the user pasted — same rungs,
 * same sizes, same codec warning — rather than through a second, simpler path that would
 * have to guess a quality.
 */
export function FormatPicker({
  formats,
  withSubtitles,
  dismissLabel,
  onConfirm,
  onDismiss
}: FormatPickerProps): JSX.Element {
  const [selected, setSelected] = useState<string | null>(null)
  const [subtitles, setSubtitles] = useState(withSubtitles)

  // Default the highlight to the first (highest) option once formats arrive, and let go
  // of a selection the current list no longer offers.
  useEffect(() => {
    if (formats.length === 0) return
    if (!selected || !formats.some((format) => format.id === selected)) setSelected(formats[0].id)
  }, [formats, selected])

  const choice = formats.find((format) => format.id === selected) ?? null

  return (
    <div className="picker">
      <div className="section-label">Choose quality</div>
      <div className="picker__options">
        {formats.map((format) => (
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
            if (choice) onConfirm(choice.id, subtitles)
          }}
        >
          Start download
        </button>
        <button type="button" className="linkbtn linkbtn--muted" onClick={onDismiss}>
          {dismissLabel}
        </button>
      </div>
    </div>
  )
}
