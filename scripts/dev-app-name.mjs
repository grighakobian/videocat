/**
 * Makes the macOS menu bar read the app's name during development.
 *
 * macOS takes the bold menu-bar title from the *running bundle's* Info.plist, not from
 * anything Electron can set at runtime — `app.setName()` and the application menu's own
 * label have no effect on it. In development the running bundle is Electron's own, so
 * the menu reads "Electron".
 *
 * Packaged builds are already correct (electron-builder writes CFBundleName from
 * productName). This patches the dev copy in node_modules so the two match. It runs from
 * `postinstall`, so a reinstall that restores the stock bundle re-applies it.
 *
 * macOS only; a no-op everywhere else and whenever the bundle is absent.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const plist = join(root, 'node_modules/electron/dist/Electron.app/Contents/Info.plist')

if (process.platform !== 'darwin') process.exit(0)
if (!existsSync(plist)) {
  // Electron's binary is downloaded post-install and may legitimately not be here yet.
  console.log('dev-app-name: Electron.app not present, skipping')
  process.exit(0)
}

const { productName } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
if (!productName) {
  console.log('dev-app-name: no productName in package.json, skipping')
  process.exit(0)
}

const read = (key) => {
  try {
    return execFileSync('defaults', ['read', plist.replace(/\.plist$/, ''), key]).toString().trim()
  } catch {
    return null
  }
}

let changed = false
for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
  if (read(key) === productName) continue
  execFileSync('plutil', ['-replace', key, '-string', productName, plist])
  changed = true
}

console.log(
  changed
    ? `dev-app-name: menu bar will read "${productName}" in development`
    : `dev-app-name: already set to "${productName}"`
)
