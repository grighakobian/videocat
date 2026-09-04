import type { JSX } from 'react'

interface ToggleProps {
  checked: boolean
  onChange(next: boolean): void
  label: string
}

export function Toggle({ checked, onChange, label }: ToggleProps): JSX.Element {
  return (
    <button
      type="button"
      className="toggle"
      role="switch"
      aria-checked={checked}
      aria-pressed={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle__knob" />
    </button>
  )
}
