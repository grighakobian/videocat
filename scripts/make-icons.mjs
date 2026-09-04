/**
 * Turns one source PNG into the icons electron-builder needs, correcting for the fact
 * that macOS and Windows want opposite things:
 *
 *   macOS  artwork inside an 824x824 area of a 1024x1024 canvas, transparent margin
 *          baked in (macOS does not mask app icons, so the padding must be in the file)
 *   Windows artwork filling the canvas edge to edge
 *
 * Usage: npm run icons -- build/icon-source.png
 * Writes build/icon.png (macOS grid), build/icon-win.png (full bleed), build/icon.icns.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ffmpeg from 'ffmpeg-static'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(process.argv[2] ?? join(root, 'build/icon-source.png'))
const build = join(root, 'build')

/** macOS icon grid: the shape occupies 824 of 1024 px, leaving ~100px of margin. */
const CANVAS = 1024
const MAC_ART = 824

const ff = (args) => execFileSync(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] })

function probe(file) {
  const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file]).toString()
  const w = Number(/pixelWidth: (\d+)/.exec(out)?.[1])
  const h = Number(/pixelHeight: (\d+)/.exec(out)?.[1])
  return { width: w, height: h }
}

/**
 * Bounding box of the actual artwork. Prefers alpha; falls back to "not near-white"
 * when the source has an opaque background, which is the common export mistake.
 */
function contentBounds(file, { width, height }, scratch) {
  const raw = join(scratch, 'probe.raw')
  ff(['-hide_banner', '-loglevel', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', raw, '-y'])
  const px = readFileSync(raw)

  let hasAlpha = false
  for (let i = 3; i < px.length; i += 4) {
    if (px[i] < 250) { hasAlpha = true; break }
  }

  const isContent = hasAlpha
    ? (o) => px[o + 3] > 8
    : (o) => px[o] < 245 || px[o + 1] < 245 || px[o + 2] < 245

  let minX = width, minY = height, maxX = -1, maxY = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (isContent((y * width + x) * 4)) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0 || maxY < 0) {
    throw new Error(
      hasAlpha
        ? 'the source is fully transparent — nothing to make an icon from'
        : 'the source is uniformly near-white — nothing to make an icon from'
    )
  }
  return { hasAlpha, x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

/** Crop to the artwork, scale it to fit `art`, then centre it on a transparent canvas. */
function compose(file, bounds, art, out) {
  ff([
    '-hide_banner', '-loglevel', 'error', '-i', file,
    '-vf', [
      // Without this the source's lack of an alpha channel makes `pad` fill opaque.
      'format=rgba',
      `crop=${bounds.w}:${bounds.h}:${bounds.x}:${bounds.y}`,
      `scale=${art}:${art}:force_original_aspect_ratio=decrease`,
      `pad=${CANVAS}:${CANVAS}:(ow-iw)/2:(oh-ih)/2:color=#00000000`
    ].join(','),
    '-y', out
  ])
}

/** sips + iconutil, both built into macOS. Every @2x is exactly twice its base size. */
function buildIcns(macPng, out, scratch) {
  const iconset = join(scratch, 'icon.iconset')
  mkdirSync(iconset, { recursive: true })
  for (const size of [16, 32, 128, 256, 512]) {
    for (const [px, name] of [[size, `icon_${size}x${size}`], [size * 2, `icon_${size}x${size}@2x`]]) {
      execFileSync('sips', ['-z', String(px), String(px), macPng, '--out', join(iconset, `${name}.png`)], {
        stdio: 'ignore'
      })
    }
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', out])
}

const scratch = mkdtempSync(join(tmpdir(), 'videocat-icons-'))
try {
  const size = probe(source)
  console.log(`source        ${size.width}x${size.height}  ${source}`)
  if (size.width !== size.height) console.warn('  ! not square — it will be letterboxed')
  if (size.width < 512) console.warn('  ! smaller than 512px; macOS and Retina will look soft')

  const bounds = contentBounds(source, size, scratch)
  console.log(`artwork       ${bounds.w}x${bounds.h} at (${bounds.x},${bounds.y})`)
  console.log(`transparency  ${bounds.hasAlpha ? 'yes' : 'NO — background is opaque'}`)
  if (!bounds.hasAlpha) {
    console.warn('  ! no alpha channel: measured the artwork by trimming near-white instead.')
    console.warn('  ! re-export with a transparent background, or macOS shows a white square.')
  }

  mkdirSync(build, { recursive: true })
  const macPng = join(build, 'icon.png')
  const winPng = join(build, 'icon-win.png')
  compose(source, bounds, MAC_ART, macPng)
  compose(source, bounds, CANVAS, winPng)
  buildIcns(macPng, join(build, 'icon.icns'), scratch)

  console.log(`\nwrote  build/icon.png      ${CANVAS}x${CANVAS}, artwork ${MAC_ART}px (macOS grid)`)
  console.log(`wrote  build/icon-win.png  ${CANVAS}x${CANVAS}, full bleed (Windows)`)
  console.log(`wrote  build/icon.icns     from the macOS version`)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
