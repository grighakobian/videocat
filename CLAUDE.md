# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

VideoCat — an Electron + React + TypeScript desktop video downloader (macOS/Windows) that
drives `yt-dlp`. `README.md` is the primary document: it explains the screens, the packaging
targets, and — most usefully — a list of yt-dlp behaviours that are easy to get wrong and are
already handled here (`--print` implying `--quiet`, two-phase merged downloads, AV1 vs H.264,
size estimates, the JS-runtime trick, pause/resume/cancel semantics, cold-start caching).
**Read the "Notes on the download engine" section before touching `src/main/ytdlp.ts`.**

The working directory is named `videocat-app` and `docs/` still uses the old *Grabbit* name; the
product, remote, and every identifier in code are **VideoCat** (`videocat:*` IPC channels,
`window.videocat`, `VIDEOCAT_DEBUG`, `videocat.json`). The design this implements is
`docs/Grabbit Downloader v2.dc.html` (README calls it "VideoCat Downloader v2.dc.html").

## Commands

```bash
npm run dev                    # electron-vite dev server + app
npm run typecheck              # tsc for main+preload and renderer separately — the only gate
npm run build                  # typecheck, then bundle to out/
npm run verify                 # all behavioural suites (real downloads, several minutes)
npm run verify queue           # one suite: input | picker | codecs | queue | cancel | concurrency | clipboard
node scripts/smoke.mjs shots   # screenshot all three screens
npm run pack:mac               # .dmg  (pack:win, pack for both)
```

There is no linter, formatter, or unit-test runner. `npm run typecheck` and the Playwright
scripts are the whole verification story. `VIDEOCAT_DEBUG=1` echoes raw yt-dlp lines.

**Launching Electron from this shell:** editors that are themselves Electron (VS Code, Claude
Code) export `ELECTRON_RUN_AS_NODE=1`, which makes the Electron binary boot as plain Node and
never open a window. `scripts/verify.mjs` and `scripts/smoke.mjs` delete it from the child env,
and `.vscode/launch.json` nulls it; do the same in anything new that spawns the app. (VideoCat
sets that same variable deliberately, but only on the yt-dlp child — see `BinaryManager.childEnv`.)

## Architecture

The main process owns *all* state. The renderer mirrors it and never mutates it — every action
is a typed call across the `contextBridge`, and every update arrives as a push.

Adding anything that crosses the boundary touches four files, in this order:

1. `src/shared/ipc.ts` — add the channel to `IPC` (`videocat:` prefix; renderer→main above the
   comment, main→renderer `onX` below it).
2. `src/main/index.ts` — `ipcMain.handle` in `registerIpc()`, or `send(IPC.onX, …)` for a push.
3. `src/preload/index.ts` — add the typed method to `api`. This object *is* the contract:
   `VideoCatApi` is derived from it and `src/preload/index.d.ts` declares it on `window`.
4. `src/renderer/src/lib/useVideoCat.ts` — for pushes, subscribe there. It is the renderer's
   single source of truth; pages read from it and call `window.videocat.*` directly for actions.

Types shared by both sides live in `src/shared/types.ts`. Path aliases: `@shared/*` everywhere,
`@/*` (renderer src) in the renderer only. `tsconfig.node.json` (main+preload+shared) and
`tsconfig.web.json` (renderer+shared) are separate projects — main code cannot import renderer
code or vice versa, and neither can reach the other's globals.

### Main-process pieces

- `queue.ts` — the live queue. Invariants worth preserving: progress is monotonic
  (`Math.max`, because a merged download reports 0→100% twice); partial-file paths are tracked
  by the *queue*, not the job, since a cancel can arrive after the process exited; a completed
  item is **deleted from the queue** and becomes a `HistoryEntry`, so the "Completed" half of
  the Downloads screen reads from history, not from the queue. `friendlyError()` is where raw yt-dlp errors become
  user-facing sentences.
- `ytdlp.ts` — the only place that knows yt-dlp's CLI. `FORMAT_SORT` is passed by *both* `probe()`
  and `buildDownloadArgs()`; that is what keeps the size in the picker equal to the size on disk,
  so change them together or not at all. Format choices are derived from yt-dlp's own ordering
  (`.at(-1)` of the filtered list) rather than a reimplementation of its ranking.
- `binaries.ts` — provisions yt-dlp's *unpacked* build (`yt-dlp_macos.zip` etc.) into
  `userData/bin/yt-dlp/` and updates it itself, since `-U` refuses to run on unpacked builds.
  Never switch back to the single-file executable: it re-extracts on every launch and macOS
  re-validates every library each time, which was a 13–15s stall per probe and per download.
  The version string (keyed to the executable's mtime) and the update-check timestamp are
  cached *in the store*, because a freshly unpacked build's first launch still costs ~13s and
  the URL bar stays disabled until `--version` answers. Unpacking uses the OS's own `tar`
  (bsdtar reads zip on macOS and Windows) so nothing is added to the bundle.
- `clipboardWatcher.ts` + `resolveClipboardLink()` in `index.ts` — the watcher is a dumb
  poller that emits *candidate* URLs; `index.ts` probes one and only pushes
  `onClipboardHit` when yt-dlp resolves it to media, so a copied non-media link stays
  silent. The whole `VideoMeta` rides along in the hit, which is what lets the suggestion
  render the full download UI (`ClipboardSuggestion` + the shared `FormatPicker`) instead
  of a one-line offer. Two things to keep: the probe waits for `engine.state === 'ready'`
  (a link copied before yt-dlp finished provisioning is resolved from the engine-ready
  callback, not failed), and the resolved `VideoMeta` is handed to `queue.add()` so
  accepting the suggestion starts the chosen quality without probing the same URL twice.
- `fileWatcher.ts` — `fs.watch` on the folders that hold finished files, filtered to the
  history entries' own names (yt-dlp's `.part` churn in the same folder is ignored). It
  never recurses; every path is known. The 30s housekeeping tick in `index.ts` re-stats
  history and re-syncs the watcher as a fallback, so a `fileExists` flip that the watcher
  misses is at most 30s late. `refreshFileExistence()` returns `changed` so nothing is
  pushed when nothing moved.
- `store.ts` — settings + history as one atomically-written JSON file in `userData`. Loading
  merges over `defaultSettings()`, so a new setting only needs adding in three places:
  `Settings` in `shared/types.ts`, `defaultSettings()`, and the Settings page.

### Renderer

Plain React 19, no state library, no CSS framework: one hand-written `styles.css` with CSS
custom properties (`--accent` is set at runtime from settings) and BEM-ish class names.
**Those class names are the test selectors** — `scripts/verify.mjs` and `scripts/smoke.mjs`
locate `.urlbar__field input`, `.card`, `.card__download` (opens a card's quality
picker, which is closed until asked for), `.toast`, `.banner`, `.nav__item`, `.picker`,
`.progress__stats`, `.setting`. Renaming a class silently breaks the suites.

Windows/macOS hide the OS frame and the renderer draws its own titlebar (`TITLEBAR_HEIGHT` in
`main/index.ts` must match `.titlebar` in the stylesheet); elsewhere the native frame stays and
the renderer hides its bar, via `getPlatform().customTitlebar`.

## Conventions

- Comments explain *why*, especially where a line encodes a hard-won yt-dlp or platform fact.
  When you fix something subtle, leave the reason next to it — that is the house style here.
- URLs are never host-checked. `isHttpUrl` is the whole validation; yt-dlp decides what it can
  extract and its error is surfaced. Do not add an allowlist.
- User-facing strings are calm, lowercase-ish sentences, never raw error dumps.

## Packaging notes

`ffmpeg-static` ships in the app and must stay in `asarUnpack` (an executable cannot run from
inside the asar). Builds are unsigned; on macOS electron-builder auto-discovers keychain
identities and will hang on `codesign` in a non-interactive shell — use
`CSC_IDENTITY_AUTO_DISCOVERY=false npm run pack:mac`.
