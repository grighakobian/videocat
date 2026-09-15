/**
 * Behavioural checks against the real app, driven through Playwright.
 *
 *   node scripts/verify.mjs            # every suite
 *   node scripts/verify.mjs clipboard  # one suite
 *
 * Suites: input, picker, codecs, queue, cancel, concurrency, clipboard.
 * These hit the network and run real downloads, so a full pass takes a few minutes.
 * State is reset first, so anything already in ~/Movies/VideoCat is left alone but the
 * settings/history store is cleared.
 */
import { _electron as electron } from 'playwright'
import { execFileSync } from 'node:child_process'
import { readdirSync, rmSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const VIDEO = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'
const only = process.argv[2] ?? null

const failures = []
let ran = 0

function check(name, ok, detail = '') {
  ran += 1
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(name)
}

/** Clears persisted settings/history so each run starts from defaults. */
function resetStore() {
  const dir = platform() === 'darwin'
    ? join(homedir(), 'Library/Application Support/videocat')
    : join(homedir(), '.config/videocat')
  rmSync(join(dir, 'videocat.json'), { force: true })
}

async function withApp(fn) {
  // Hosts like Claude Code and VS Code export ELECTRON_RUN_AS_NODE=1, which would make
  // the Electron binary boot as plain Node and never open a window.
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE

  const app = await electron.launch({ args: ['.'], cwd: process.cwd(), env })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  win.on('pageerror', (error) => check(`no renderer error: ${error.message}`, false))

  // The URL bar stays disabled until yt-dlp is provisioned and version-checked, which
  // on a cold start is 15-25s. Wait for that rather than guessing at a sleep. The button
  // is also disabled on an empty field, so seed it, wait, then clear.
  const seed = win.locator('.urlbar__field input')
  const downloadButton = win.locator('.urlbar .btn', { hasText: 'Download' })
  let engineReady = false
  try {
    await seed.fill(VIDEO)
    for (let i = 0; i < 300; i += 1) {
      if (await downloadButton.isEnabled()) { engineReady = true; break }
      await sleep(1000)
    }
    await seed.fill('')
  } catch (error) {
    // The window can disappear here if the app fails to start; report it as this
    // suite's failure rather than tearing down the whole run.
    check('app stayed up while the engine started', false, error.message.split('\n')[0])
    await app.close().catch(() => {})
    return
  }
  if (!engineReady) check('engine became ready', false, 'timed out after 300s')

  try {
    await fn(win)
  } catch (error) {
    // One suite failing should not hide the results of the ones after it.
    check(`suite completed`, false, error.message.split('\n')[0])
  } finally {
    await app.close()
  }
}

const helpers = (win) => ({
  input: win.locator('.urlbar__field input'),
  setting: (label) => win.locator('.setting', { hasText: label }),
  stats: () => win.locator('.progress__stats').allTextContents(),
  clipboardBanner: () => win.locator('.banner', { hasText: 'clipboard' }),
  go: async (page) => {
    await win.locator('.nav__item', { hasText: page }).click()
    await sleep(400)
  },
  /** Adds VIDEO and starts it at the named format, via the picker every add opens. */
  queueOne: async (format) => {
    await win.locator('.nav__item', { hasText: 'Downloads' }).click()
    await win.locator('.urlbar__field input').fill(VIDEO)
    await win.locator('.urlbar .btn', { hasText: 'Download' }).click()
    try {
      await win.locator('.picker').last().waitFor({ timeout: 180_000 })
    } catch {
      // Usually the probe failed. Surface what the app said rather than a bare timeout —
      // a long run makes many requests and YouTube does throttle them.
      const reported = await win.locator('.card__error').allTextContents()
      throw new Error(
        reported.length
          ? `format picker never appeared; app reported: ${reported[0]}`
          : 'format picker never appeared and no error was shown (slow or throttled probe?)'
      )
    }
    await win.locator('.picker').last().locator('.option', { hasText: format }).first().click()
    await win.locator('.picker').last().locator('.btn--sm', { hasText: 'Start' }).click()
    await sleep(500)
  },
  /** Throttles downloads so ordering and pause/resume are observable. */
  throttle: async (clicks = 4) => {
    await win.locator('.nav__item', { hasText: 'Settings' }).click()
    await sleep(400)
    const row = win.locator('.setting', { hasText: 'Limit speed' })
    await row.locator('.toggle').click()
    await sleep(300)
    for (let i = 0; i < clicks; i += 1) {
      await row.locator('button[aria-label="Lower the speed cap"]').click()
      await sleep(250)
    }
  },
  waitFor: async (predicate, seconds = 120) => {
    for (let i = 0; i < seconds; i += 1) {
      await sleep(1000)
      if (await predicate()) return true
    }
    return false
  }
})

const suites = {
  /**
   * The field takes any http(s) URL. yt-dlp reaches well over a thousand sites, so a
   * host allowlist would reject most of what it can actually download; only input that
   * is not a URL at all is turned away.
   */
  async input(win) {
    const h = helpers(win)
    await h.input.fill('this is not a link')
    await win.locator('.urlbar .btn', { hasText: 'Download' }).click()
    await sleep(800)
    const toast = await win.locator('.toast').textContent().catch(() => '')
    check('non-URL text is rejected', /does not look like a link/i.test(toast), JSON.stringify(toast))
    check('non-URL text queues nothing', (await win.locator('.card').count()) === 0)
    await win.locator('.toast .banner__close').click().catch(() => {})

    // A non-YouTube host must be accepted rather than refused up front.
    await h.input.fill('https://archive.org/details/BigBuckBunny_124')
    await win.locator('.urlbar .btn', { hasText: 'Download' }).click()
    const queued = await h.waitFor(async () => (await win.locator('.card').count()) > 0, 20)
    check('a non-YouTube URL is accepted', queued)
    check('no rejection toast for a non-YouTube URL',
      (await win.locator('.toast').count()) === 0)
  },

  /**
   * Quality is asked for every download: adding a link opens the picker and nothing
   * starts until a rung is chosen, so no setting can silently pick a quality.
   */
  async picker(win) {
    const h = helpers(win)
    await h.input.fill(VIDEO)
    await win.locator('.urlbar .btn', { hasText: 'Download' }).click()
    await win.locator('.card').first().waitFor({ timeout: 30_000 })
    await win.locator('.picker').waitFor({ timeout: 180_000 })
    check('adding a link opens the format picker', (await win.locator('.picker').count()) === 1)

    // Long enough that an auto-started download would have reported progress by now.
    await sleep(5000)
    check('nothing downloads before a quality is picked',
      (await win.locator('.progress__percent').count()) === 0)

    await win.locator('.picker').locator('.option', { hasText: '1080p' }).first().click()
    await win.locator('.picker').locator('.btn--sm', { hasText: 'Start' }).click()
    const started = await h.waitFor(
      async () => (await win.locator('.progress__percent').count()) > 0, 200)
    check('starts once a quality is chosen', started)
    const chips = (await win.locator('.card__meta').first().textContent()) ?? ''
    check('downloads the quality that was picked', /1080p/.test(chips), chips)
  },

  /**
   * Guards the QuickTime bug: yt-dlp defaults to AV1, which macOS cannot decode, so
   * a downloaded file would not open. Rungs that can be H.264 must be, and rungs that
   * cannot must say so rather than silently producing an unplayable file.
   */
  async codecs(win) {
    const h = helpers(win)
    await h.input.fill(VIDEO)
    await win.locator('.urlbar .btn', { hasText: 'Download' }).click()
    await win.locator('.picker').waitFor({ timeout: 180_000 })

    const optionText = async (label) =>
      (await win.locator('.option', { hasText: label }).first().textContent()) ?? ''
    check('1080p is H.264', /H\.264/.test(await optionText('1080p')), await optionText('1080p'))
    check('720p is H.264', /H\.264/.test(await optionText('720p')), await optionText('720p'))
    // YouTube has no H.264 above 1080p, so 4K is necessarily VP9/AV1.
    check('4K reports its codec', /VP9|AV1/.test(await optionText('4K')), await optionText('4K'))

    await win.locator('.option', { hasText: '4K' }).click()
    await sleep(300)
    check('4K warns that QuickTime cannot play it',
      /QuickTime/.test((await win.locator('.picker__note').textContent().catch(() => '')) ?? ''))

    await win.locator('.option', { hasText: '1080p' }).click()
    await sleep(300)
    check('1080p shows no warning', (await win.locator('.picker__note').count()) === 0)

    // Resolution must never be traded away for a compatible codec.
    check('4K is still offered at 4K', /4K/.test(await optionText('4K')))
  },

  /** Pause all / Resume all across the whole queue. */
  async queue(win) {
    const h = helpers(win)
    await h.throttle()
    await h.queueOne('1080p')
    await h.waitFor(async () => (await h.stats()).some((s) => /B\/s/.test(s)), 200)

    await win.locator('.linkbtn', { hasText: 'Pause all' }).click()
    await sleep(2500)
    check('Pause all pauses the queue', /Paused/.test((await h.stats())[0] ?? ''))
    check('Resume all offered once nothing runs',
      (await win.locator('.linkbtn', { hasText: 'Resume all' }).count()) === 1)

    await win.locator('.linkbtn', { hasText: 'Resume all' }).click()
    await sleep(1000)
    check('Resume all restarts the queue',
      (await win.locator('.linkbtn', { hasText: 'Pause all' }).count()) === 1)
  },

  /** Cancelling must not leave partial files behind; pausing must keep them. */
  async cancel(win) {
    const h = helpers(win)
    await h.throttle()
    await h.go('Settings')
    const dir = (await h.setting('Save to').locator('.setting__hint').textContent()).trim()
    const parts = () => readdirSync(dir).filter((f) => f.endsWith('.part'))

    await h.queueOne('4K')
    await h.waitFor(async () => (await h.stats()).some((s) => /B\/s/.test(s)), 200)
    // Let enough of the stream land that yt-dlp has opened its .part file.
    await h.waitFor(async () => parts().length > 0, 60)
    check('a .part file exists while downloading', parts().length > 0, JSON.stringify(parts()))

    // Pausing keeps the partial file so --continue can resume from it.
    await win.locator('.iconbtn[aria-label="Pause"]').first().click()
    await sleep(3000)
    check('pause keeps the .part file for resuming', parts().length > 0)

    await win.locator('.iconbtn[aria-label="Cancel"]').first().click()
    const cleaned = await h.waitFor(async () => parts().length === 0, 20)
    check('cancel removes the partial file', cleaned, JSON.stringify(parts()))
    check('cancel removes the card', (await win.locator('.card').count()) === 0)
  },

  /** The simultaneous-downloads limit, including changing it mid-flight. */
  async concurrency(win) {
    const h = helpers(win)
    await h.go('Settings')
    // Step down to 1 regardless of the default, so changing the default does not break this.
    while ((await h.setting('Simultaneous').locator('.stepper__value').textContent()) !== '1') {
      await h.setting('Simultaneous').locator('button[aria-label="Fewer simultaneous downloads"]').click()
      await sleep(250)
    }
    check('limit set to 1',
      (await h.setting('Simultaneous').locator('.stepper__value').textContent()) === '1')
    await h.throttle()

    // Two jobs for one video, in formats that produce different files.
    await h.queueOne('MP3 only')
    await h.queueOne('1080p')
    check('two items queued', (await win.locator('.card').count()) === 2)

    await h.waitFor(async () => (await h.stats()).some((s) => /B\/s/.test(s)), 200)
    const stats = await h.stats()
    check('only one runs at a time',
      stats.filter((s) => /B\/s/.test(s)).length === 1, JSON.stringify(stats))
    check('the other is held as Queued', stats.filter((s) => /Queued/.test(s)).length === 1)

    await h.go('Settings')
    await h.setting('Simultaneous').locator('button[aria-label="More simultaneous downloads"]').click()
    await h.go('Downloads')
    const released = await h.waitFor(async () => {
      const now = await h.stats()
      return now.length < 2 || !now.some((s) => /Queued/.test(s))
    }, 90)
    check('raising the limit releases the waiting item', released)
  },

  /** Clipboard watching, the ⌘V shortcut, and the off switch. */
  async clipboard(win) {
    const h = helpers(win)
    const copy = (text) => {
      if (platform() === 'darwin') return execFileSync('pbcopy', { input: text })
      if (platform() === 'win32') return execFileSync('clip', { input: text })
      return execFileSync('xclip', ['-selection', 'clipboard'], { input: text })
    }

    copy(VIDEO)
    check('detects a copied link',
      await h.waitFor(async () => (await h.clipboardBanner().count()) > 0, 10))

    await h.clipboardBanner().locator('.banner__close').click()
    await sleep(400)
    check('banner dismisses', (await h.clipboardBanner().count()) === 0)

    copy('just some text, not a link at all')
    await sleep(3000)
    check('ignores clipboard text that is not a URL', (await h.clipboardBanner().count()) === 0)

    // Any host is fair game now, not only YouTube.
    copy('https://archive.org/details/BigBuckBunny_124')
    check('offers a non-YouTube link too',
      await h.waitFor(async () => (await h.clipboardBanner().count()) > 0, 10))
    await h.clipboardBanner().locator('.banner__close').click()
    await sleep(400)

    // Re-copying a dismissed link should stay quiet.
    copy('some other plain text')
    await sleep(2000)
    copy(VIDEO)
    await sleep(3500)
    check('does not re-offer a dismissed link', (await h.clipboardBanner().count()) === 0)

    copy('https://youtu.be/aqz-KE-bpKQ')
    await sleep(2000)
    await win.locator('.sidebar').click() // focus away from the text field
    const pasteKey = platform() === 'darwin' ? 'Meta+v' : 'Control+v'
    await win.keyboard.press(pasteKey)
    await sleep(1200)
    check('⌘V fills the URL bar', (await h.input.inputValue()).includes('youtu.be'))

    // Removing the Edit menu can take the editing shortcuts with it on macOS, and
    // pasting a link into the URL bar is the app's main interaction.
    await h.input.fill('')
    await h.input.click()
    await win.keyboard.press(pasteKey)
    await sleep(800)
    check('⌘V pastes into the focused URL field', (await h.input.inputValue()).includes('youtu.be'))

    await h.input.fill('')
    await win.locator('.banner__close').first().click().catch(() => {})
    await h.go('Settings')
    await h.setting('Watch clipboard').locator('.toggle').click()
    await sleep(500)
    await h.go('Downloads')
    copy('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    await sleep(4000)
    check('stops when the setting is off', (await h.clipboardBanner().count()) === 0)
  }
}

const selected = only ? { [only]: suites[only] } : suites
if (only && !suites[only]) {
  console.error(`Unknown suite "${only}". Available: ${Object.keys(suites).join(', ')}`)
  process.exit(2)
}

for (const [name, suite] of Object.entries(selected)) {
  console.log(`\n${name}`)
  resetStore()
  await withApp(suite)
}

console.log(
  `\n${failures.length ? `FAILED (${failures.length}/${ran}): ${failures.join(', ')}` : `ALL ${ran} CHECKS PASSED`}`
)
process.exit(failures.length ? 1 : 0)
