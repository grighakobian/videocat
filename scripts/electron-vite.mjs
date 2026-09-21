/**
 * Runs electron-vite with a clean environment.
 *
 * Editor-hosted terminals — VS Code's, Claude Code's — export ELECTRON_RUN_AS_NODE=1 for
 * their own Electron tooling, and npm passes it straight through. The Electron binary
 * then boots as plain Node, so `app` is undefined and the main process dies on
 * `app.whenReady()` before any window opens. The renderer's dev server survives, which
 * makes it look like the app is "running" at localhost:5173 — but opening that URL in a
 * browser gives a page with no preload bridge and nothing works.
 *
 * verify.mjs strips the variable for the same reason. This does it for `dev` and `start`.
 *
 * Usage: node scripts/electron-vite.mjs <subcommand> [args...]
 */
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const windows = process.platform === 'win32'
const bin = join(root, 'node_modules/.bin', windows ? 'electron-vite.cmd' : 'electron-vite')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(bin, process.argv.slice(2), {
  cwd: root,
  env,
  stdio: 'inherit',
  // Windows cannot exec a .cmd directly.
  shell: windows
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
