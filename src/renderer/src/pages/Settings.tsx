import { useEffect, useState, type JSX } from 'react'
import type { Settings } from '@shared/types'
import { Toggle } from '../components/Toggle'

interface SettingsPageProps {
  settings: Settings
}

const ACCENTS = ['#E8501F', '#7B61C9', '#1F8A5B', '#1D6FE0']

const MIN_CONCURRENT = 1
const MAX_CONCURRENT = 6

function update(patch: Partial<Settings>): void {
  void window.videocat.updateSettings(patch)
}

export function SettingsPage({ settings }: SettingsPageProps): JSX.Element {
  const [version, setVersion] = useState('—')

  useEffect(() => {
    void window.videocat.getVersion().then(setVersion)
  }, [])

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-head__title">Settings</div>
      </div>

      <div className="settings">
        <div className="settings__group">
          <div className="section-label">Downloads</div>

          <div className="setting">
            <div className="setting__text">
              <div className="setting__name">Save to</div>
              <div className="setting__hint" title={settings.downloadDirectory}>
                {settings.downloadDirectory}
              </div>
            </div>
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              onClick={() => void window.videocat.chooseDownloadDirectory()}
            >
              Change…
            </button>
          </div>

          <div className="setting">
            <div className="setting__text">
              <div className="setting__name">Simultaneous downloads</div>
              <div className="setting__hint">More is faster, but hungrier</div>
            </div>
            <div className="stepper">
              <button
                type="button"
                aria-label="Fewer simultaneous downloads"
                disabled={settings.maxConcurrentDownloads <= MIN_CONCURRENT}
                onClick={() =>
                  update({ maxConcurrentDownloads: settings.maxConcurrentDownloads - 1 })
                }
              >
                −
              </button>
              <span className="stepper__value">{settings.maxConcurrentDownloads}</span>
              <button
                type="button"
                aria-label="More simultaneous downloads"
                disabled={settings.maxConcurrentDownloads >= MAX_CONCURRENT}
                onClick={() =>
                  update({ maxConcurrentDownloads: settings.maxConcurrentDownloads + 1 })
                }
              >
                +
              </button>
            </div>
          </div>
        </div>

        <div className="settings__group">
          <div className="section-label">Behavior</div>

          <div className="setting">
            <div className="setting__text">
              <div className="setting__name">Watch clipboard</div>
              <div className="setting__hint">Offer to grab links you copy</div>
            </div>
            <Toggle
              label="Watch clipboard"
              checked={settings.watchClipboard}
              onChange={(value) => update({ watchClipboard: value })}
            />
          </div>

          <div className="setting">
            <div className="setting__text">
              <div className="setting__name">Download subtitles</div>
              <div className="setting__hint">Save .srt next to the video</div>
            </div>
            <Toggle
              label="Download subtitles"
              checked={settings.downloadSubtitles}
              onChange={(value) => update({ downloadSubtitles: value })}
            />
          </div>

          <div className="setting">
            <div className="setting__text">
              <div className="setting__name">Limit speed</div>
              <div className="setting__hint">
                Cap at {settings.speedLimitMbps} MB/s while downloading
              </div>
            </div>
            {settings.limitSpeed ? (
              <div className="stepper">
                <button
                  type="button"
                  aria-label="Lower the speed cap"
                  disabled={settings.speedLimitMbps <= 1}
                  onClick={() => update({ speedLimitMbps: settings.speedLimitMbps - 1 })}
                >
                  −
                </button>
                <span className="stepper__value">{settings.speedLimitMbps}</span>
                <button
                  type="button"
                  aria-label="Raise the speed cap"
                  disabled={settings.speedLimitMbps >= 100}
                  onClick={() => update({ speedLimitMbps: settings.speedLimitMbps + 1 })}
                >
                  +
                </button>
              </div>
            ) : null}
            <Toggle
              label="Limit speed"
              checked={settings.limitSpeed}
              onChange={(value) => update({ limitSpeed: value })}
            />
          </div>

          <div className="setting">
            <div className="setting__text">
              <div className="setting__name">Notify when done</div>
              <div className="setting__hint">System notification per finished file</div>
            </div>
            <Toggle
              label="Notify when done"
              checked={settings.notifyOnComplete}
              onChange={(value) => update({ notifyOnComplete: value })}
            />
          </div>
        </div>

        <div className="settings__group">
          <div className="section-label">Appearance</div>
          <div className="setting">
            <div className="setting__text">
              <div className="setting__name">Accent color</div>
              <div className="setting__hint">Used for buttons, progress, and the active page</div>
            </div>
            <div className="swatches">
              {ACCENTS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className="swatch"
                  style={{ background: color }}
                  aria-label={`Accent ${color}`}
                  aria-pressed={settings.accentColor.toUpperCase() === color}
                  onClick={() => update({ accentColor: color })}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="footnote">VideoCat {version}</div>
      </div>
    </div>
  )
}
