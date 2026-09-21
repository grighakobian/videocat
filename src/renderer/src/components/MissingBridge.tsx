import type { JSX } from 'react'
import { Logo } from './Logo'

/**
 * Shown when the renderer loaded without the preload bridge — in practice, the
 * dev-server URL opened in a browser tab rather than the VideoCat window.
 */
export function MissingBridge(): JSX.Element {
  return (
    <div className="nobridge">
      <Logo size={48} />
      <h1 className="nobridge__title">Open VideoCat itself</h1>
      <p className="nobridge__text">
        This page is only the interface. Downloads, settings and the library all live in the
        VideoCat app, so nothing here works in a browser tab.
      </p>
      <p className="nobridge__text nobridge__text--dim">
        Run <code className="nobridge__code">npm run dev</code> and use the window it opens.
      </p>
    </div>
  )
}
