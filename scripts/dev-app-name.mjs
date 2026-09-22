/**
 * Makes the macOS menu bar and the About panel show VideoCat during development.
 *
 * macOS takes the bold menu-bar title, and the icon the About panel and Dock show, from
 * the *running bundle's* Info.plist — not from anything Electron can set at runtime.
 * `app.setName()` and the application menu's own label have no effect on the title, and
 * `setAboutPanelOptions` cannot reach the icon on macOS (it is NSApplicationIcon, read
 * from the bundle). In development the running bundle is Electron's own, so without this
 * the menu reads "Electron" and About shows Electron's atom.
 *
 * Packaged builds are already correct (electron-builder writes CFBundleName from
 * productName and installs build/icon.icns). This patches the dev copy in node_modules so
 * the two match. It runs from `postinstall`, so a reinstall that restores the stock bundle
 * re-applies it.
 *
 * macOS only; a no-op everywhere else and whenever the bundle is absent.
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const bundle = join(root, 'node_modules/electron/dist/Electron.app')
const plist = join(bundle, 'Contents/Info.plist')
const iconSource = join(root, 'build/icon.icns')
/** Named for the app, not for Electron, so the stock electron.icns is left in place. */
const iconName = 'videocat'

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

// The icon the About panel and the Dock show is a file inside the bundle, so it has to
// be copied in; CFBundleIconFile then names it (without the extension).
if (existsSync(iconSource)) {
  const installed = join(bundle, `Contents/Resources/${iconName}.icns`)
  copyFileSync(iconSource, installed)
  if (read('CFBundleIconFile') !== iconName) {
    execFileSync('plutil', ['-replace', 'CFBundleIconFile', '-string', iconName, plist])
    changed = true
  }
} else {
  console.log('dev-app-name: build/icon.icns not present, leaving the icon alone')
}

console.log(
  changed
    ? `dev-app-name: menu bar and About will read "${productName}" in development`
    : `dev-app-name: already set to "${productName}"`
)
