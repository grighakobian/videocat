/**
 * Renders build/icon-source.png (1024x1024, rounded tile on a transparent surround)
 * and then hands it to `make-icons.mjs` for the platform icons.
 *
 *   npm run icon path/to/artwork.png   use that PNG as the tile (opaque, square)
 *   npm run icon                       reuse build/icon-artwork.png if present, else
 *                                      draw the cat mark from Logo.tsx on the accent tile
 *
 * A supplied PNG is copied to build/icon-artwork.png so the repo keeps the original and
 * a bare `npm run icon` regenerates the same result. It is treated as the *whole* tile:
 * scaled to cover 1024x1024 and clipped to macOS's rounded-square corners. Anything
 * outside the corners becomes transparent, which is what lets `make-icons.mjs` add the
 * macOS margin instead of trimming the background away and leaving a floating mark.
 *
 * The built-in mark is drawn as an SVG mask so its eyes and mouth are cut-outs that
 * show the gradient through them, rather than painted in a flat colour that would
 * never quite match it.
 */
import { _electron as electron } from 'playwright'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const build = join(root, 'build')
const ACCENT = '#E8501F'

const TILE = 1024
/** macOS's continuous-corner radius is ~22.4% of the tile. */
const RADIUS = 229
/** The mark's own artwork box, from Logo.tsx. */
const MARK_H = 545
/** Rendered width of the mark. The whiskers trail off its right edge, so the screen
 * body (617 of the 700 units) is what gets centred, not the full box. */
const MARK_SCALE = 0.86
const BODY_W = 617 * MARK_SCALE
const markX = (TILE - BODY_W) / 2
const markY = (TILE - MARK_H * MARK_SCALE) / 2 + 8

const artworkFile = join(build, 'icon-artwork.png')
const supplied = process.argv[2] ? resolve(process.argv[2]) : null
mkdirSync(build, { recursive: true })
if (supplied) {
  if (!existsSync(supplied)) throw new Error(`no such file: ${supplied}`)
  if (resolve(supplied) !== artworkFile) copyFileSync(supplied, artworkFile)
  console.log('artwork', supplied)
}
const useArtwork = existsSync(artworkFile)

const builtInMark = `
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#F2733F"/>
      <stop offset="0.55" stop-color="${ACCENT}"/>
      <stop offset="1" stop-color="#C93D12"/>
    </linearGradient>
    <mask id="mark" maskUnits="userSpaceOnUse">
      <g transform="translate(${markX} ${markY}) scale(${MARK_SCALE})">
        <g fill="#fff">
          <path d="M125 0 L125 108 L214 108 Z"/>
          <path d="M490 0 L490 108 L401 108 Z"/>
          <rect x="0" y="100" width="617" height="440" rx="104"/>
        </g>
        <g stroke="#fff" stroke-width="30" stroke-linecap="round">
          <path d="M596 256 H684"/>
          <path d="M596 338 H700"/>
          <path d="M596 420 H684"/>
        </g>
        <g fill="#000">
          <circle cx="205" cy="285" r="46"/>
          <circle cx="406" cy="285" r="46"/>
        </g>
        <path d="M250 386 Q309 478 368 386" fill="none" stroke="#000" stroke-width="32" stroke-linecap="round"/>
      </g>
    </mask>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="130%">
      <feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#501600" flood-opacity="0.28"/>
    </filter>
  </defs>
  <rect width="${TILE}" height="${TILE}" rx="${RADIUS}" fill="url(#tile)"/>
  <rect width="${TILE}" height="${TILE}" fill="#fff" mask="url(#mark)" filter="url(#shadow)"/>`

const artworkTile = useArtwork
  ? `
  <clipPath id="corners"><rect width="${TILE}" height="${TILE}" rx="${RADIUS}"/></clipPath>
  <image width="${TILE}" height="${TILE}" preserveAspectRatio="xMidYMid slice" clip-path="url(#corners)"
    href="data:image/png;base64,${readFileSync(artworkFile).toString('base64')}"/>`
  : ''

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${TILE}" viewBox="0 0 ${TILE} ${TILE}">
${useArtwork ? artworkTile : builtInMark}
</svg>`

const html = `<!doctype html><meta charset="utf-8"><style>
  html, body { margin: 0; background: transparent; }
  .mark { width: ${TILE}px; height: ${TILE}px; display: block; }
</style><body><img class="mark" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"></body>`

// A throwaway Electron app whose only job is to host a window Playwright can screenshot.
const stage = mkdtempSync(join(tmpdir(), 'videocat-icon-'))
writeFileSync(join(stage, 'package.json'), JSON.stringify({ name: 'icon', main: 'main.js' }))
writeFileSync(join(stage, 'index.html'), html)
writeFileSync(
  join(stage, 'main.js'),
  `const { app, BrowserWindow } = require('electron')
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 1100, height: 1100, show: true })
  win.loadFile(__dirname + '/index.html')
})`
)

// Editors that are themselves Electron export this, which would boot the binary as Node.
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const electronApp = await electron.launch({ args: [stage], cwd: root, env })
const win = await electronApp.firstWindow()
await win.waitForLoadState('load')
await win.locator('.mark').evaluate((img) => img.decode())

// `omitBackground` is what keeps the corners outside the tile transparent.
const buffer = await win.locator('.mark').screenshot({ scale: 'css', omitBackground: true })
const out = join(build, 'icon-source.png')
writeFileSync(out, buffer)
console.log('wrote', out, buffer.length, 'bytes', useArtwork ? '(from artwork)' : '(built-in mark)')
await electronApp.close()

execFileSync(process.execPath, [join(root, 'scripts/make-icons.mjs'), out], { stdio: 'inherit' })
