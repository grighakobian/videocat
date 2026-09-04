import type { JSX } from 'react'
import type { DiskSpace, PageId } from '@shared/types'
import { formatBytes } from '../lib/format'
import { CheckCircleIcon, DownloadIcon, GridIcon, SlidersIcon } from './Icons'
import { Logo } from './Logo'

interface SidebarProps {
  page: PageId
  onNavigate(page: PageId): void
  activeCount: number
  disk: DiskSpace | null
}

const NAV: { id: PageId; label: string; Icon: typeof DownloadIcon }[] = [
  { id: 'downloads', label: 'Downloads', Icon: DownloadIcon },
  { id: 'completed', label: 'Completed', Icon: CheckCircleIcon },
  { id: 'library', label: 'Library', Icon: GridIcon },
  { id: 'settings', label: 'Settings', Icon: SlidersIcon }
]

export function Sidebar({ page, onNavigate, activeCount, disk }: SidebarProps): JSX.Element {
  const usedFraction =
    disk && disk.totalBytes > 0 ? 1 - disk.freeBytes / disk.totalBytes : 0

  return (
    <nav className="sidebar">
      <div className="brand">
        <Logo />
        <div className="brand__name">VideoCat</div>
      </div>

      <div className="nav">
        {NAV.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            className={`nav__item${page === id ? ' nav__item--active' : ''}`}
            aria-current={page === id ? 'page' : undefined}
            onClick={() => onNavigate(id)}
          >
            <Icon />
            {label}
            {id === 'downloads' && activeCount > 0 ? (
              <span className="nav__badge">{activeCount}</span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="disk">
        <div className="disk__label">Disk space</div>
        <div className="disk__bar">
          <div className="disk__fill" style={{ width: `${Math.round(usedFraction * 100)}%` }} />
        </div>
        <div className="disk__text">
          {disk
            ? `${formatBytes(disk.freeBytes)} free of ${formatBytes(disk.totalBytes)}`
            : 'Checking…'}
        </div>
      </div>
    </nav>
  )
}
