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

const YTDLP_ASSET: Record<string, string> = {
  darwin: 'yt-dlp_macos',
  win32: 'yt-dlp.exe',
  linux: 'yt-dlp'
}

const RELEASE_BASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download'
const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000

/**
 * Locates the two external binaries VideoCat needs.
 *
 * ffmpeg ships with the app (via ffmpeg-static). yt-dlp is fetched into userData on
 * first run and self-updates from there — YouTube breaks extractors often enough that
 * pinning a copy inside the bundle would leave the app broken between releases.
 */
export class BinaryManager {
  private readonly binDir = join(app.getPath('userData'), 'bin')
  private readonly ytdlpPath = join(this.binDir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')
  private status: EngineStatus = { state: 'checking', version: null, message: null, progress: null }

  constructor(
    private readonly onStatusChange: (status: EngineStatus) => void,
    /**
     * Reads/writes the last update-check time. It has to outlive the process —
     * yt-dlp's standalone binary is slow to start, so re-checking on every launch
     * would add a pointless network round trip and delay to each cold boot.
     */
    private readonly updateCheckClock: { get(): number; set(timestamp: number): void },
    /**
     * Caches the version string against the binary's mtime. Asking yt-dlp its own
     * version costs a full 15-25s cold start, which would leave the URL bar disabled
     * on every launch; the cache means only a genuinely new binary pays that.
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
      if (!existsSync(this.ytdlpPath)) {
        this.setStatus({ state: 'downloading', message: 'Downloading the download engine…', progress: 0 })
        await this.downloadYtdlp()
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

  /** Cached where possible; `force` skips the cache after an update replaced the binary. */
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

  private async downloadYtdlp(): Promise<void> {
    const asset = YTDLP_ASSET[process.platform]
    if (!asset) throw new Error(`VideoCat does not support ${process.platform} yet.`)

    mkdirSync(this.binDir, { recursive: true })
    const target = `${this.ytdlpPath}.part`
    rmSync(target, { force: true })

    await new Promise<void>((resolve, reject) => {
      const request = (url: string, redirects = 0): void => {
        if (redirects > 5) {
          reject(new Error('Too many redirects fetching yt-dlp.'))
          return
        }
        httpsGet(url, { headers: { 'user-agent': 'VideoCat' } }, (response: IncomingMessage) => {
          const { statusCode = 0, headers } = response
          if (statusCode >= 300 && statusCode < 400 && headers.location) {
            response.resume()
            request(new URL(headers.location, url).toString(), redirects + 1)
            return
          }
          if (statusCode !== 200) {
            response.resume()
            reject(new Error(`Could not download yt-dlp (HTTP ${statusCode}).`))
            return
          }

          const total = Number(headers['content-length'] ?? 0)
          let received = 0
          const file = createWriteStream(target)
          response.on('data', (chunk: Buffer) => {
            received += chunk.length
            if (total > 0) this.setStatus({ progress: received / total })
          })
          response.pipe(file)
          file.on('finish', () => file.close(() => resolve()))
          file.on('error', reject)
          response.on('error', reject)
        }).on('error', reject)
      }
      request(`${RELEASE_BASE}/${asset}`)
    })

    renameSync(target, this.ytdlpPath)
    if (process.platform !== 'win32') chmodSync(this.ytdlpPath, 0o755)
  }

  /** Runs `yt-dlp -U` at most once a day, in the background. Failures are non-fatal. */
  private async maybeSelfUpdate(): Promise<void> {
    const now = Date.now()
    if (now - this.updateCheckClock.get() < UPDATE_INTERVAL_MS) return
    this.updateCheckClock.set(now)
    try {
      await execFileAsync(this.ytdlpPath, ['-U'], { timeout: 120_000 })
      // `-U` may have replaced the binary, so re-read rather than trust the cache.
      this.setStatus({ version: await this.readVersion(true) })
    } catch {
      // Keep running on the version we have; an offline launch should not block downloads.
    }
  }

  /** Forces an update check, for the Settings screen button. */
  async updateEngine(): Promise<EngineStatus> {
    this.updateCheckClock.set(0)
    if (!existsSync(this.ytdlpPath)) return this.ensureReady()
    this.setStatus({ state: 'downloading', message: 'Checking for engine updates…', progress: null })
    await this.maybeSelfUpdate()
    this.setStatus({ state: 'ready', message: null, progress: null })
    return this.getStatus()
  }
}
