import { useEffect, useState, type JSX, type SyntheticEvent } from 'react'
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
 *
 * The frame is landscape, and so is most artwork, which simply fills it. Portrait art
 * (Shorts, Reels, TikTok) would otherwise be cropped to a sliver of its middle, so it
 * is shown whole instead, letter-boxed over a blurred, scaled-up copy of itself. The
 * orientation is only known once the image has loaded, hence the state.
 */
export function Thumb({ kind, url, durationSeconds, className }: ThumbProps): JSX.Element {
  const [failed, setFailed] = useState(false)
  const [portrait, setPortrait] = useState(false)
  const showImage = Boolean(url) && !failed
  const duration = formatDuration(durationSeconds)

  // A new URL is a new image: forget what we learned about the last one.
  useEffect(() => {
    setFailed(false)
    setPortrait(false)
  }, [url])

  const onLoad = (event: SyntheticEvent<HTMLImageElement>): void => {
    const { naturalWidth, naturalHeight } = event.currentTarget
    setPortrait(naturalWidth > 0 && naturalHeight > naturalWidth)
  }

  return (
    <div
      className={[
        'thumb',
        kind === 'audio' && !showImage ? 'thumb--audio' : '',
        showImage && portrait ? 'thumb--portrait' : '',
        className ?? ''
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {showImage ? (
        <>
          {portrait ? (
            // Decorative backdrop: the same picture, blurred and scaled to cover.
            <img className="thumb__backdrop" src={url as string} alt="" aria-hidden="true" />
          ) : null}
          <img
            className="thumb__image"
            src={url as string}
            alt=""
            loading="lazy"
            onLoad={onLoad}
            onError={() => setFailed(true)}
          />
        </>
      ) : kind === 'audio' ? (
        <MusicIcon size={22} />
      ) : null}
      {duration ? <span className="thumb__duration">{duration}</span> : null}
    </div>
  )
}
