/** Presentation helpers. Everything here is pure so the pages stay declarative. */
import { formatBytes } from '@shared/format'

export { formatBytes }

export function formatSpeed(bytesPerSecond: number | null): string | null {
  if (!bytesPerSecond || bytesPerSecond <= 0) return null
  return `${formatBytes(bytesPerSecond)}/s`
}

export function formatDuration(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return null
  const total = Math.round(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const pad = (value: number): string => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`
}

/**
 * How far a download has got, in the terms the user picked it by: "412 MB / 1.3 GB".
 * Both numbers are cumulative across a merged download's two streams, so this is the
 * same fraction the bar is drawing. Without a known total — a live stream, or a server
 * that sends no length — the downloaded size stands on its own.
 */
export function formatTransferred(downloaded: number | null, total: number | null): string | null {
  if (downloaded === null || !Number.isFinite(downloaded)) return null
  if (total === null || !Number.isFinite(total)) return formatBytes(downloaded)
  return `${formatBytes(downloaded)} / ${formatBytes(total)}`
}

export function formatTimeOfDay(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** "Today" / "Yesterday" / "12 March", used to group the history list. */
export function dayLabel(timestamp: number): string {
  const date = new Date(timestamp)
  const today = new Date()
  const startOf = (value: Date): number =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
  const dayMs = 24 * 60 * 60 * 1000
  const diffDays = Math.round((startOf(today) - startOf(date)) / dayMs)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return date.toLocaleDateString([], { weekday: 'long' })
  return date.toLocaleDateString([], { day: 'numeric', month: 'long' })
}

export function isSameDay(timestamp: number, reference: number): boolean {
  const a = new Date(timestamp)
  const b = new Date(reference)
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  )
}

/** Groups history newest-first into day buckets, preserving order. */
export function groupByDay<T extends { completedAt: number }>(
  entries: T[]
): { label: string; items: T[] }[] {
  const groups: { label: string; items: T[] }[] = []
  for (const entry of [...entries].sort((a, b) => b.completedAt - a.completedAt)) {
    const label = dayLabel(entry.completedAt)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(entry)
    else groups.push({ label, items: [entry] })
  }
  return groups
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}
