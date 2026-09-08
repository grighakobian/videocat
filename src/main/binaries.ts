import { app } from 'electron'
import { execFile } from 'node:child_process'
import {
  chmodSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync
} from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { get as httpsGet } from 'node:https'
import type { IncomingMessage } from 'node:http'
import ffmpegStatic from 'ffmpeg-static'
import type { EngineStatus } from '@shared/types'

const execFileAsync = promisify(execFile)

/**
 * yt-dlp is fetched as its *unpacked* ("onedir") PyInstaller build, not the single-file
 * executable. The single-file build unpacks a ~70MB Python runtime into a brand-new temp
 * folder on every launch, and on macOS the kernel then validates the code signature of
 * every freshly written library before dyld may load it — that, not extraction itself,
 * is the 13-15s "cold start" every probe and download used to pay. With the unpacked
 * build the files stay put, macOS validates them once, and yt-dlp starts in ~0.2s.
 *
 * Each zip holds the executable named below plus an `_internal/` folder beside it.
 * The macOS build is a universal binary, so it has no per-arch variant.
 */
interface YtdlpAsset {
  zip: string
  exe: string
}

const YTDLP_ASSETS: Record<string, YtdlpAsset> = {
  darwin: { zip: 'yt-dlp_macos.zip', exe: 'yt-dlp_macos' },
  'win32-x64': { zip: 'yt-dlp_win.zip', exe: 'yt-dlp.exe' },
  'win32-arm64': { zip: 'yt-dlp_win_arm64.zip', exe: 'yt-dlp_arm64.exe' },
  'linux-x64': { zip: 'yt-dlp_linux.zip', exe: 'yt-dlp_linux' },
  'linux-arm64': { zip: 'yt-dlp_linux_aarch64.zip', exe: 'yt-dlp_linux_aarch64' }
}

function assetForThisMachine(): YtdlpAsset | null {
  const key = process.platform === 'darwin' ? 'darwin' : `${process.platform}-${process.arch}`
  return YTDLP_ASSETS[key] ?? null
}

const RELEASE_BASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download'
/** GitHub redirects `releases/latest/download/<asset>` here; the tag is the version. */
const RELEASE_TAG_IN_LOCATION = /\/releases\/download\/([^/]+)\//
const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000

/**
 * Locates the two external binaries VideoCat needs.
 *
 * ffmpeg ships with the app (via ffmpeg-static). yt-dlp is fetched into userData on
 * first run and updated from there — YouTube breaks extractors often enough that
 * pinning a copy inside the bundle would leave the app broken between releases.
 *
 * Layout under `userData/bin`:
 *   yt-dlp/            the unpacked build currently in use (exe + `_internal/`)
 *   yt-dlp.new/        staging folder while a fresh zip is being unpacked
 *   yt-dlp.old/        the previous build, briefly, while a swap is in flight
 *   yt-dlp.zip.part    download in progress
 * Older installs left a single-file `yt-dlp` / `yt-dlp.exe` here; it is removed on
 * the first run that provisions the unpacked build.
 */
export class BinaryManager {
  private readonly binDir = join(app.getPath('userData'), 'bin')
  private readonly asset = assetForThisMachine()
  private readonly engineDir = join(this.binDir, 'yt-dlp')
  private readonly stagingDir = join(this.binDir, 'yt-dlp.new')
  private readonly retiredDir = join(this.binDir, 'yt-dlp.old')
  private readonly zipPart = join(this.binDir, 'yt-dlp.zip.part')
  private readonly ytdlpPath = join(this.engineDir, this.asset?.exe ?? 'yt-dlp')
  private status: EngineStatus = { state: 'checking', version: null, message: null, progress: null }

  constructor(
    private readonly onStatusChange: (status: EngineStatus) => void,
    /**
     * Reads/writes the last update-check time. It has to outlive the process so an
     * update check is a once-a-day network round trip, not one per launch.
     */
    private readonly updateCheckClock: { get(): number; set(timestamp: number): void },
    /**
     * Caches the version string against the executable's mtime. A warm yt-dlp answers
     * `--version` in a fraction of a second, but the *first* launch of a freshly
     * unpacked build still costs ~13s on macOS while the OS validates its libraries,
     * and that first launch should never land on the URL bar's critical path.
     */
    private readonly versionCache: {
      get(mtimeMs: number): string | null
      set(version: string, mtimeMs: number): void
    }
  ) {}

  getStatus(): EngineStatus {
    return { ...this.status }
  }

  private setStatus(patch: Partial<EngineStatus>): void {
    this.status = { ...this.status, ...patch }
    this.onStatusChange(this.getStatus())
  }

  /**
   * ffmpeg-static resolves to a path inside app.asar once packaged, but the archive
   * is not executable — electron-builder unpacks it, so point at the unpacked copy.
   */
  ffmpegPath(): string | null {
    if (!ffmpegStatic) return null
    return app.isPackaged
      ? ffmpegStatic.replace('app.asar', 'app.asar.unpacked')
      : ffmpegStatic
  }

  /** Directory ffmpeg lives in — yt-dlp takes `--ffmpeg-location` as a dir or a file. */
  ffmpegDir(): string | null {
    const path = this.ffmpegPath()
    return path ? join(path, '..') : null
  }

  ytdlp(): string {
    return this.ytdlpPath
  }

  /**
   * yt-dlp needs a JavaScript runtime for full YouTube extraction — without one it
   * warns that extraction is deprecated and quietly offers fewer formats. Rather than
   * asking the user to install Deno or Node, point it at our own Electron binary,
   * which runs as plain Node when ELECTRON_RUN_AS_NODE is set (see `childEnv`).
   */
  jsRuntimeArgs(): string[] {
    return ['--js-runtimes', `node:${process.execPath}`]
  }

  /** Environment for yt-dlp, so the runtime it spawns behaves as Node and not as Electron. */
  childEnv(): NodeJS.ProcessEnv {
    return { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  }

  /** Downloads yt-dlp if missing, then reports its version. Safe to call repeatedly. */
  async ensureReady(): Promise<EngineStatus> {
    if (this.status.state === 'downloading') return this.getStatus()
    try {
      this.sweepLeftovers()
      if (!existsSync(this.ytdlpPath)) {
        this.setStatus({ state: 'downloading', message: 'Downloading the download engine…', progress: 0 })
        await this.install(null, (progress) => this.setStatus({ progress }))
      }
      if (this.versionCache.get(this.binaryMtime()) === null) {
        // First launch of this build: the OS validates every library once. Say so
        // rather than leaving the URL bar disabled with no explanation.
        this.setStatus({ state: 'downloading', message: 'Preparing the download engine…', progress: null })
      }
      const version = await this.readVersion()
      this.setStatus({ state: 'ready', version, message: null, progress: null })
      void this.maybeSelfUpdate()
    } catch (error) {
      this.setStatus({
        state: 'error',
        message: error instanceof Error ? error.message : String(error),
        progress: null
      })
    }
    return this.getStatus()
  }

  private binaryMtime(): number {
    return statSync(this.ytdlpPath).mtimeMs
  }

  /** Cached where possible; `force` skips the cache after an update replaced the build. */
  private async readVersion(force = false): Promise<string> {
    const mtimeMs = this.binaryMtime()
    if (!force) {
      const cached = this.versionCache.get(mtimeMs)
      if (cached) return cached
    }
    const { stdout } = await execFileAsync(this.ytdlpPath, ['--version'], { timeout: 60_000 })
    const version = stdout.trim()
    this.versionCache.set(version, mtimeMs)
    return version
  }

  /**
   * Removes whatever an interrupted install or swap left behind. On Windows the retired
   * build cannot be deleted while a download is still running from it, so it may
   * survive until the next launch — which is exactly when this runs.
   */
  private sweepLeftovers(): void {
    rmSync(this.zipPart, { force: true })
    rmSync(this.stagingDir, { recursive: true, force: true })
    rmSync(this.retiredDir, { recursive: true, force: true })
  }

  /**
   * Fetches the latest release and swaps it into place. Returns false — having
   * downloaded nothing — when `currentVersion` already is the latest release, which
   * GitHub tells us in the redirect before a single byte of the zip is sent.
   */
  private async install(
    currentVersion: string | null,
    onProgress: (fraction: number) => void
  ): Promise<boolean> {
    const asset = this.asset
    if (!asset) throw new Error(`VideoCat does not support ${process.platform}/${process.arch} yet.`)

    mkdirSync(this.binDir, { recursive: true })
    rmSync(this.zipPart, { force: true })

    const downloaded = await this.downloadZip(`${RELEASE_BASE}/${asset.zip}`, currentVersion, onProgress)
    if (!downloaded) return false

    rmSync(this.stagingDir, { recursive: true, force: true })
    mkdirSync(this.stagingDir, { recursive: true })
    await extractZip(this.zipPart, this.stagingDir)
    rmSync(this.zipPart, { force: true })

    const stagedExe = join(this.stagingDir, asset.exe)
    if (!existsSync(stagedExe)) {
      rmSync(this.stagingDir, { recursive: true, force: true })
      throw new Error(`The yt-dlp archive did not contain ${asset.exe}.`)
    }
    if (process.platform !== 'win32') chmodSync(stagedExe, 0o755)

    this.swapIn()
    return true
  }

  /**
   * Replaces `yt-dlp/` with the staged build. Two renames rather than a delete-then-
   * rename so a crash in between leaves a complete build under one name or the other.
   * Also clears the single-file binary older installs kept at the directory's path.
   */
  private swapIn(): void {
    rmSync(this.retiredDir, { recursive: true, force: true })
    if (existsSync(this.engineDir)) {
      if (statSync(this.engineDir).isFile()) rmSync(this.engineDir, { force: true })
      else renameSync(this.engineDir, this.retiredDir)
    }
    renameSync(this.stagingDir, this.engineDir)
    for (const legacy of ['yt-dlp.exe', 'yt-dlp.part', 'yt-dlp.exe.part']) {
      rmSync(join(this.binDir, legacy), { force: true })
    }
    try {
      rmSync(this.retiredDir, { recursive: true, force: true })
    } catch {
      // Windows refuses while the old exe is running a download; sweepLeftovers() gets it.
    }
  }

  /**
   * Streams the release asset to `zipPart`, following GitHub's redirects. Resolves
   * false without downloading when the redirect's release tag equals `skipVersion`.
   */
  private downloadZip(
    url: string,
    skipVersion: string | null,
    onProgress: (fraction: number) => void
  ): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      const request = (target: string, redirects: number): void => {
        if (redirects > 5) {
          reject(new Error('Too many redirects fetching yt-dlp.'))
          return
        }
        httpsGet(target, { headers: { 'user-agent': 'VideoCat' } }, (response: IncomingMessage) => {
          const { statusCode = 0, headers } = response
          if (statusCode >= 300 && statusCode < 400 && headers.location) {
            response.resume()
            const tag = RELEASE_TAG_IN_LOCATION.exec(headers.location)?.[1]
            if (skipVersion !== null && tag === skipVersion) {
              resolve(false)
              return
            }
            request(new URL(headers.location, target).toString(), redirects + 1)
            return
          }
          if (statusCode !== 200) {
            response.resume()
            reject(new Error(`Could not download yt-dlp (HTTP ${statusCode}).`))
            return
          }

          const total = Number(headers['content-length'] ?? 0)
          let received = 0
          const file = createWriteStream(this.zipPart)
          response.on('data', (chunk: Buffer) => {
            received += chunk.length
            if (total > 0) onProgress(received / total)
          })
          response.pipe(file)
          file.on('finish', () => file.close(() => resolve(true)))
          file.on('error', reject)
          response.on('error', reject)
        }).on('error', reject)
      }
      request(url, 0)
    })
  }

  /**
   * Checks for a newer release at most once a day, in the background. yt-dlp's own
   * `-U` refuses to run on the unpacked build ("Auto-update is not supported for
   * unpackaged executables"), so the swap is ours. Failures are non-fatal.
   */
  private async maybeSelfUpdate(showProgress = false): Promise<void> {
    const now = Date.now()
    if (now - this.updateCheckClock.get() < UPDATE_INTERVAL_MS) return
    this.updateCheckClock.set(now)
    try {
      const onProgress = showProgress ? (progress: number) => this.setStatus({ progress }) : () => {}
      const updated = await this.install(this.status.version, onProgress)
      // The build was replaced, so re-read rather than trust the cache.
      if (updated) this.setStatus({ version: await this.readVersion(true) })
    } catch {
      // Keep running on the version we have; an offline launch should not block downloads.
    }
  }

  /** Forces an update check, for the Settings screen button. */
  async updateEngine(): Promise<EngineStatus> {
    this.updateCheckClock.set(0)
    if (!existsSync(this.ytdlpPath)) return this.ensureReady()
    this.setStatus({ state: 'downloading', message: 'Checking for engine updates…', progress: null })
    await this.maybeSelfUpdate(true)
    this.setStatus({ state: 'ready', message: null, progress: null })
    return this.getStatus()
  }
}

/**
 * Unpacks with the archiver the OS already ships, so nothing is added to the bundle:
 * bsdtar reads zip files and preserves the executable bit, and both macOS and
 * Windows 10+ install it as `tar`. GNU tar on Linux does not read zip, hence `unzip`.
 */
async function extractZip(zipPath: string, destination: string): Promise<void> {
  const [command, args] =
    process.platform === 'linux'
      ? ['unzip', ['-q', '-o', zipPath, '-d', destination]]
      : ['tar', ['-xf', zipPath, '-C', destination]]
  try {
    await execFileAsync(command, args, { timeout: 120_000, windowsHide: true })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Could not unpack yt-dlp with ${command}: ${detail}`)
  }
}
