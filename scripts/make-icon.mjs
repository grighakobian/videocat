/**
 * Renders build/icon.png (1024x1024) from the brand mark. electron-builder derives the
 * .icns and .ico from this single file.
 * Usage: npm run icon
 */
import { _electron as electron } from 'playwright'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ACCENT = '#E8501F'
const fontUrl = `file://${join(root, 'src/renderer/src/assets/outfit-variable.woff2')}`

const html = `<!doctype html><meta charset="utf-8"><style>
  @font-face { font-family: Outfit; src: url('${fontUrl}') format('woff2'); font-weight: 400 700; }
  html, body { margin: 0; background: #fff; }
  .mark {
    width: 1024px; height: 1024px; box-sizing: border-box;
    display: grid; place-items: center;
    border-radius: 228px;
    background: linear-gradient(155deg, #F2733F, ${ACCENT} 55%, #C93D12);
    color: #fff; font-family: Outfit, -apple-system, Helvetica, sans-serif;
    font-weight: 700; font-size: 620px; line-height: 1; letter-spacing: -0.03em;
    text-shadow: 0 12px 34px rgba(80, 22, 0, 0.32);
  }
</style><body><div class="mark">G</div></body>`

// A throwaway Electron app whose only job is to host a window Playwright can screenshot.
const stage = mkdtempSync(join(tmpdir(), 'grabbit-icon-'))
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

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const electronApp = await electron.launch({ args: [stage], cwd: root, env })
const win = await electronApp.firstWindow()
await win.waitForLoadState('load')
await win.waitForFunction(() => document.fonts.ready.then(() => true))

const buffer = await win.locator('.mark').screenshot({ scale: 'css' })
mkdirSync(join(root, 'build'), { recursive: true })
const out = join(root, 'build/icon.png')
writeFileSync(out, buffer)
console.log('wrote', out, buffer.length, 'bytes')
await electronApp.close()
