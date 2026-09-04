import type { JSX } from 'react'

interface LogoProps {
  /** Rendered height in px; the mark is wider than it is tall. */
  size?: number
  className?: string
}

/**
 * The VideoCat mark: a cat-faced screen with whiskers trailing off the right edge.
 *
 * Inline rather than an image so it stays sharp at any size and follows the accent
 * colour. The eyes and mouth are painted in the surrounding panel colour, which is what
 * the sidebar sits on — if the mark ever moves onto a different background, they need
 * to become a mask instead.
 */
export function Logo({ size = 27, className }: LogoProps): JSX.Element {
  // viewBox matches the artwork's own proportions (700 x 545).
  return (
    <svg
      width={Math.round(size * (700 / 545))}
      height={size}
      viewBox="0 0 700 545"
      fill="none"
      role="img"
      aria-label="VideoCat"
      className={className}
    >
      <g fill="var(--accent)">
        <path d="M125 0 L125 108 L214 108 Z" />
        <path d="M490 0 L490 108 L401 108 Z" />
        <rect x="0" y="100" width="617" height="440" rx="104" />
      </g>
      <g stroke="var(--accent)" strokeWidth="30" strokeLinecap="round">
        <path d="M596 256 H684" />
        <path d="M596 338 H700" />
        <path d="M596 420 H684" />
      </g>
      <g fill="var(--panel)">
        <circle cx="205" cy="285" r="46" />
        <circle cx="406" cy="285" r="46" />
      </g>
      <path
        d="M250 386 Q309 478 368 386"
        fill="none"
        stroke="var(--panel)"
        strokeWidth="32"
        strokeLinecap="round"
      />
    </svg>
  )
}
