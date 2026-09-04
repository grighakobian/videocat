/**
 * Launches the built app under Playwright, drives the UI, and writes screenshots.
 * Usage: npm run build && node scripts/smoke.mjs [outDir] [--url <youtube-url>]
 */
import { _electron as electron } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const args = process.argv.slice(2)
const outDir = args.find((a) => !a.startsWith('--')) ?? 'shots'
const urlFlag = args.indexOf('--url')
const testUrl = urlFlag >= 0 ? args[urlFlag + 1] : null
const formatFlag = args.indexOf('--format')
const testFormat = formatFlag >= 0 ? args[formatFlag + 1] : 'MP3 only'
const pauseTest = args.includes('--pause')
mkdirSync(outDir, { recursive: true })

// Some hosts (Claude Code, VS Code) export ELECTRON_RUN_AS_NODE=1, which would make the
// Electron binary boot as plain Node and never create a window.
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const app = await electron.launch({ args: ['.'], cwd: process.cwd(), env })
const win = await app.firstWindow()
await win.waitForLoadState('domcontentloaded')
win.on('console', (m) => console.log(`[renderer:${m.type()}]`, m.text()))
win.on('pageerror', (e) => console.log('[pageerror]', e.message))

const shot = async (name) => {
  await win.screenshot({ path: join(outDir, `${name}.png`) })
  console.log('  shot ->', join(outDir, `${name}.png`))
}

await sleep(2000)
console.log('TITLE:', await win.title())
console.log('NAV:', (await win.locator('.nav__item').allTextContents()).join(' | '))
console.log('DISK:', await win.locator('.disk__text').textContent())
console.log('ENGINE BANNER:', (await win.locator('.banner__text').allTextContents()).join(' | '))
await shot('01-downloads')

for (const page of ['Completed', 'Library', 'Settings']) {
  await win.locator('.nav__item', { hasText: page }).click()
  await sleep(400)
  console.log(`${page.toUpperCase()}:`, await win.locator('.titlebar__label').textContent())
  await shot(`0${['Completed', 'Library', 'Settings'].indexOf(page) + 2}-${page.toLowerCase()}`)
}

if (testUrl) {
  await win.locator('.nav__item', { hasText: 'Downloads' }).click()
  // Wait for the engine to finish provisioning before asking it to do work.
  for (let i = 0; i < 120; i += 1) {
    const banner = await win.locator('.banner__text').allTextContents()
    if (!banner.some((t) => /engine/i.test(t))) break
    await sleep(1000)
  }
  await win.locator('.urlbar__field input').fill(testUrl)
  await win.locator('.btn--ghost', { hasText: 'Choose quality' }).click()

  await win.locator('.picker').waitFor({ timeout: 120_000 })
  console.log('CARD TITLE:', await win.locator('.card__title').first().textContent())
  console.log('FORMATS:', (await win.locator('.option').allTextContents()).join(' | '))
  await shot('05-format-picker')

  await win.locator('.option', { hasText: testFormat }).first().click()
  await win.locator('.btn--sm', { hasText: 'Start download' }).click()

  if (pauseTest) {
    await win.locator('.progress__percent').waitFor()
    // Let it get far enough that a .part file exists to resume from.
    for (let i = 0; i < 60; i += 1) {
      await sleep(500)
      const pct = await win.locator('.progress__percent').first().textContent()
      if (parseInt(pct, 10) > 2) break
    }
    const before = await win.locator('.progress__percent').first().textContent()
    await win.locator('.iconbtn[aria-label="Pause"]').first().click()
    await sleep(2500)
    console.log('PAUSED AT:', before, '-> stats:', await win.locator('.progress__stats').first().textContent())
    await shot('05b-paused')
    await win.locator('.iconbtn[aria-label="Resume"]').first().click()
    await sleep(4000)
    const after = await win.locator('.progress__percent').first().textContent()
    console.log('RESUMED:', before, '->', after)
    console.log('RESUME KEPT PROGRESS:', parseInt(after, 10) >= parseInt(before, 10) - 1)
  }

  // Poll until the queue card disappears (completed) or reports an error. Compare against
  // the starting row count so leftover history from an earlier run is not read as success.
  const rowsBefore = await win.locator('.row__title').count()
  let outcome = 'timeout'
  for (let i = 0; i < 300; i += 1) {
    await sleep(1000)
    if (i === 4) {
      console.log('MID-DOWNLOAD:', await win.locator('.progress__percent').first().textContent(),
        '|', await win.locator('.progress__stats').first().textContent())
      await shot('06-downloading')
    }
    const err = await win.locator('.card__error').allTextContents()
    if (err.length > 0) {
      outcome = `error: ${err[0]}`
      break
    }
    if ((await win.locator('.row__title').count()) > rowsBefore) {
      outcome = `completed: ${await win.locator('.row__title').first().textContent()}`
      break
    }
  }
  console.log('DOWNLOAD OUTCOME:', outcome)
  await shot('07-after-download')

  await win.locator('.nav__item', { hasText: 'Library' }).click()
  await sleep(600)
  console.log('LIBRARY TILES:', await win.locator('.tile__title').count())
  await shot('08-library-filled')
}

await app.close()
console.log('done')
