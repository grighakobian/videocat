# VideoCat

A calm desktop video downloader for macOS and Windows. Paste a video link, pick a
quality, get a file.

Built with Electron, React, and TypeScript, implementing the **V2 "Clean"** design
exploration from `VideoCat Downloader v2.dc.html`.

## Screens

| | |
|---|---|
| **Downloads** | Global paste bar (⌘V / Ctrl+V from anywhere), clipboard-detect banner, live queue with per-item progress, speed and ETA, pause/resume/cancel, an inline quality picker, and today's completed files. |
| **Completed** | Download history grouped by day, with Play, Show in Finder/Explorer, and Remove. Entries whose file has since moved are dimmed. |
| **Library** | Grid of everything still on disk, filterable by All / Video / Audio. Click to play, double-click to reveal. |
| **Settings** | Save folder, default quality, simultaneous downloads, clipboard watching, subtitles, speed cap, notifications, and accent color. |

## Running it

```bash
npm install
npm run dev
```

> **Why the macOS menu bar would otherwise say "Electron".** That bold title comes from
> the *running bundle's* `Info.plist`, and in development the running bundle is
> `node_modules/electron/dist/Electron.app`. Nothing in Electron's API changes it —
> neither `app.setName()` nor the application menu's own label, which AppKit ignores for
> this. `scripts/dev-app-name.mjs` patches that dev bundle's `CFBundleName` to match
> `productName`, and runs from `postinstall` so a reinstall re-applies it. Packaged
> builds never needed it: electron-builder writes `CFBundleName` from `productName`.

In VS Code, press **F5** — `.vscode/launch.json` has configs for both platforms:
*VideoCat* (run with main-process breakpoints), *VideoCat + renderer* (add renderer
breakpoints), *Preview production build*, and *Verification suite*. Each unsets
`ELECTRON_RUN_AS_NODE`, for the reason below.

On first launch VideoCat downloads `yt-dlp` into its user-data folder and keeps it
updated (checked at most once a day). `ffmpeg` ships with the app via `ffmpeg-static`.

> If your shell exports `ELECTRON_RUN_AS_NODE=1` — some editors and terminals do — the
> Electron binary boots as plain Node and no window appears. Unset it for the launch.
> (VideoCat sets that same variable deliberately, but only on the yt-dlp child process —
> see the engine notes below.)

## Building installers

```bash
npm run pack:mac   # .dmg (arm64 + x64)
npm run pack:win   # NSIS installer (x64 + arm64)
npm run pack       # both
```

`npm run icon` regenerates `build/icon.png` from the brand mark; electron-builder
derives the `.icns` and `.ico` from it.

Neither target is signed or notarized — add credentials before distributing. On macOS,
electron-builder auto-discovers any signing identity in your keychain and will **hang**
on `codesign` if the keychain can't be unlocked (CI, or a non-interactive shell). For a
deliberately unsigned build:

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false npm run pack:mac
```

## Architecture

The main process owns *all* state. The renderer mirrors it and never mutates it
directly — every action is a typed call across the `contextBridge`.

```
src/
  shared/      types.ts, ipc.ts,        — the contract between both sides
               format.ts
  main/
    index.ts            app lifecycle, window, IPC handlers
    binaries.ts         finds/provisions yt-dlp and ffmpeg
    ytdlp.ts            metadata probes, format list, download jobs
    queue.ts            ordering, concurrency, per-item lifecycle
    store.ts            settings + history, atomically persisted JSON
    clipboardWatcher.ts polls for copied video links
    fileWatcher.ts      watches finished files so history shows moved/deleted ones
    disk.ts             free/total space for the sidebar
  preload/     index.ts                — the only surface the renderer can reach
  renderer/    React app (App, pages/, components/, lib/)
```

### Notes on the download engine

A few things about driving `yt-dlp` that are easy to get wrong, and are handled here:

- **`--print` implies `--quiet`**, which silently suppresses every progress line.
  `--no-quiet` is required alongside it.
- **A merged download is two sequential downloads** (video, then audio), each reporting
  its own 0→100%. `ytdlp.ts` accumulates finished streams so the bar only moves forward.
- **yt-dlp defaults to AV1**, which QuickTime and older Windows players cannot decode —
  a downloaded `.mp4` simply refuses to open. VideoCat passes
  `--format-sort res,vcodec:h264,acodec:aac` so files come back as H.264 + AAC. The
  order matters: resolution has to lead, because YouTube only serves H.264 up to 1080p
  and sorting by codec first would hand back a 1080p file to someone who asked for 4K.
  1440p and 4K are therefore VP9, and the picker says so.
- **Size estimates come from yt-dlp's own ordering, not a reimplementation of it.**
  `--dump-single-json` returns `formats` already sorted worst-to-best under the
  `--format-sort` that was passed, so the last match is exactly what `bestvideo` will
  choose. The probe and the download pass the same sort, which is what keeps the size
  in the picker equal to the size on disk.
- **yt-dlp needs a JavaScript runtime** for full YouTube extraction. Without one it
  warns that extraction is deprecated and silently offers fewer formats. Rather than
  making users install Deno or Node, VideoCat points it at **its own Electron binary**
  (`--js-runtimes node:$(process.execPath)`), which runs as plain Node when
  `ELECTRON_RUN_AS_NODE=1` — set on the yt-dlp child process, and inherited by the
  runtime yt-dlp spawns. No extra dependency, nothing for the user to install.
- **Pause** sends `SIGTERM` and leaves the `.part` file; **resume** re-runs with
  `--continue`. **Cancel** stops and deletes the partial files — and because a cancel
  can arrive after the process already exited (pause, then cancel), the queue tracks
  those paths rather than the job.
- yt-dlp's standalone binary has a slow (~15–25s) cold start, so a download shows
  "Starting…" until real bytes move.
- That cold start is expensive enough that two things are cached in the store rather
  than in memory, so only a genuinely new binary pays it: the version string (keyed to
  the binary's mtime — otherwise every launch would sit with the URL bar disabled while
  `--version` ran) and the `yt-dlp -U` timestamp, which rate-limits updates to once a
  day across restarts. Settings → Update engine forces a check.

## Development

```bash
npm run typecheck              # main + renderer
npm run build                  # typecheck, then bundle to out/
npm run verify                 # behavioural checks against the real app
npm run verify clipboard       # just one suite
node scripts/smoke.mjs shots   # walk all four screens, screenshot each
node scripts/smoke.mjs shots --url "<youtube-url>" --format 1080p --pause
```

Both scripts drive the actual app through Playwright rather than mocking it, because
every real bug in this codebase so far has been in the seam between the UI and yt-dlp,
where a unit test would have been mocked into agreeing with itself.

- **`scripts/verify.mjs`** — suites for `input`, `autostart`, `codecs`, `queue`,
  `cancel`, `concurrency`, and `clipboard`: URL validation, the primary Download button
  auto-starting at the default quality, H.264 where it exists and a warning where it
  does not, Pause all / Resume all, pause keeping the
  `.part` file while cancel deletes it, the simultaneous-downloads limit (including
  raising it mid-flight), and clipboard watching with the ⌘V shortcut. It runs real
  downloads over the network, so a full pass takes several minutes and resets the
  settings/history store first. Back-to-back suites make a lot of requests to the same
  video and YouTube will occasionally throttle them; a suite that fails this way says
  so and the remaining suites still run. Re-run the single suite to confirm
  (`npm run verify queue`).
- **`scripts/smoke.mjs`** — walks every screen and screenshots it; with `--url` it runs
  one download end to end, optionally exercising `--pause`.

Set `VIDEOCAT_DEBUG=1` to echo every raw yt-dlp line to the terminal.

## Scope

Whatever yt-dlp can extract — well over a thousand sites. The URL field does not check
the host, only that the input is an http(s) URL; anything yt-dlp cannot handle comes
back as a normal download error. The clipboard watcher offers any copied link for the
same reason, so it is more talkative than a host allowlist would be; the banner is
dismissible, dismissed links are not offered again, and Settings can turn it off.

Quality and codec handling is tuned against YouTube, which is the best-covered source.
Other sites publish different format sets, so the picker shows whatever they actually
offer rather than a fixed ladder.

VideoCat is a tool for downloading video you have the right to download. Respect the
terms of the sites you use it with, and creators' rights.
