import { forwardRef, type JSX } from 'react'
import { LinkIcon } from './Icons'

interface UrlBarProps {
  value: string
  onChange(value: string): void
  /** `autoStart` true downloads at the default quality; false opens the format picker. */
  onSubmit(autoStart: boolean): void
  disabled: boolean
}

const shortcutHint = navigator.platform.toLowerCase().includes('mac') ? '⌘V' : 'Ctrl V'

export const UrlBar = forwardRef<HTMLInputElement, UrlBarProps>(function UrlBar(
  { value, onChange, onSubmit, disabled },
  ref
): JSX.Element {
  const empty = value.trim().length === 0

  return (
    <div className="urlbar">
      <div className="urlbar__field">
        <span className="urlbar__icon">
          <LinkIcon size={15} />
        </span>
        <input
          ref={ref}
          value={value}
          spellCheck={false}
          placeholder="Paste a video link…"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !empty && !disabled) onSubmit(!event.altKey)
          }}
        />
        {empty ? <span className="kbd">{shortcutHint}</span> : null}
      </div>
      <button
        type="button"
        className="btn btn--ghost"
        disabled={empty || disabled}
        onClick={() => onSubmit(false)}
        title="Add to the queue and pick a quality"
      >
        Choose quality
      </button>
      <button type="button" className="btn" disabled={empty || disabled} onClick={() => onSubmit(true)}>
        Download
      </button>
    </div>
  )
})
