import type { JSX, SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Icon({ size = 16, children, ...rest }: IconProps & { children: JSX.Element }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const DownloadIcon = (props: IconProps): JSX.Element => (
  <Icon {...props}>
    <g>
      <path d="M8 2.5v7" />
      <path d="M4.8 6.7 8 9.9l3.2-3.2" />
      <path d="M2.5 11v1.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V11" />
    </g>
  </Icon>
)

export const CheckCircleIcon = (props: IconProps): JSX.Element => (
  <Icon {...props}>
    <g>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M5.6 8.2 7.3 9.9l3.1-3.4" />
    </g>
  </Icon>
)

export const GridIcon = (props: IconProps): JSX.Element => (
  <Icon {...props}>
    <g>
      <rect x="2.5" y="2.5" width="4.6" height="4.6" rx="1.2" />
      <rect x="8.9" y="2.5" width="4.6" height="4.6" rx="1.2" />
      <rect x="2.5" y="8.9" width="4.6" height="4.6" rx="1.2" />
      <rect x="8.9" y="8.9" width="4.6" height="4.6" rx="1.2" />
    </g>
  </Icon>
)

export const SlidersIcon = (props: IconProps): JSX.Element => (
  <Icon {...props}>
    <g>
      <path d="M2.5 4.5h11" />
      <path d="M2.5 8h11" />
      <path d="M2.5 11.5h11" />
      <circle cx="10.5" cy="4.5" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="5.5" cy="8" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="9" cy="11.5" r="1.5" fill="currentColor" stroke="none" />
    </g>
  </Icon>
)

export const LinkIcon = (props: IconProps): JSX.Element => (
  <Icon {...props}>
    <g>
      <path d="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2-2a2.6 2.6 0 0 0-3.7-3.7l-.7.7" />
      <path d="M9.4 6.6a2.6 2.6 0 0 0-3.7 0l-2 2a2.6 2.6 0 0 0 3.7 3.7l.7-.7" />
    </g>
  </Icon>
)

export const PauseIcon = (props: IconProps): JSX.Element => (
  <Icon {...props}>
    <g>
      <path d="M6 3.5v9" />
      <path d="M10 3.5v9" />
    </g>
  </Icon>
)

export const PlayIcon = (props: IconProps): JSX.Element => (
  <Icon {...props}>
    <path d="M5.5 3.4 12 8l-6.5 4.6z" fill="currentColor" />
  </Icon>
)

export const CloseIcon = (props: IconProps): JSX.Element => (
  <Icon {...props}>
    <g>
      <path d="M4 4l8 8" />
      <path d="M12 4l-8 8" />
    </g>
  </Icon>
)

export const RetryIcon = (props: IconProps): JSX.Element => (
  <Icon {...props}>
    <g>
      <path d="M13 8a5 5 0 1 1-1.6-3.7" />
      <path d="M13.2 2.6v2.8h-2.8" />
    </g>
  </Icon>
)

export const FolderIcon = (props: IconProps): JSX.Element => (
  <Icon {...props}>
    <path d="M2.2 4.4a1 1 0 0 1 1-1h2.6l1.2 1.5h5.8a1 1 0 0 1 1 1v5.7a1 1 0 0 1-1 1H3.2a1 1 0 0 1-1-1z" />
  </Icon>
)

export const MusicIcon = (props: IconProps): JSX.Element => (
  <Icon {...props}>
    <g>
      <path d="M6 11.5V4l6-1.3v7" />
      <circle cx="4.6" cy="11.7" r="1.7" />
      <circle cx="10.6" cy="10.4" r="1.7" />
    </g>
  </Icon>
)
