import { useState, type JSX } from 'react'
import type { MediaKind } from '@shared/types'
import { formatDuration } from '../lib/format'
import { MusicIcon } from './Icons'

interface ThumbProps {
  kind: MediaKind
  url: string | null
  durationSeconds?: number | null
  className?: string
}

/**
 * Video artwork with graceful fallbacks: the striped placeholder from the design when
 * there is no thumbnail yet, and a music glyph for audio-only downloads.
 */
export function Thumb({ kind, url, durationSeconds, className }: ThumbProps): JSX.Element {
  const [failed, setFailed] = useState(false)
  const showImage = Boolean(url) && !failed
  const duration = formatDuration(durationSeconds)

  return (
    <div
      className={['thumb', kind === 'audio' && !showImage ? 'thumb--audio' : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
    >
      {showImage ? (
        <img src={url as string} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : kind === 'audio' ? (
        <MusicIcon size={22} />
      ) : null}
      {duration ? <span className="thumb__duration">{duration}</span> : null}
    </div>
  )
}
