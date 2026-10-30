import { spawn } from 'node:child_process'
import { readdirSync, watchFile, unwatchFile } from 'node:fs'
import { resolve } from 'node:path'

let stopping = false
let restarting = false
let restartTimer
let backend
const children = new Set()
const watched = new Set()
let discovery

function launch(args, label) {
  const child = spawn(process.execPath, args, { stdio: 'inherit' })
  children.add(child)
  child.on('error', error => {
    console.error(`[${label}] ${error.message}`)
    stop(1)
  })
  child.on('exit', (code, signal) => {
    children.delete(child)
    if (stopping) return
    // The API handles SIGTERM gracefully and exits with code 0, so Node's
    // exit event may have a null signal even though we requested the restart.
    if (label === 'api' && restarting) {
      restarting = false
      backend = startBackend()
      return
    }
    // A failed child must make npm run dev fail, not exit successfully.
    stop(code ?? (signal ? 1 : 0))
  })
  return child
}
function startBackend() {
  return launch(['--experimental-strip-types', 'server/index.ts'], 'api')
}
function stop(code = 0) {
  if (stopping) return
  stopping = true
  clearTimeout(restartTimer)
  clearInterval(discovery)
  for (const file of watched) unwatchFile(file)
  for (const child of children) child.kill('SIGTERM')
  process.exitCode = code
  const force = setTimeout(() => {
    for (const child of children) child.kill('SIGKILL')
    process.exit(code)
  }, 3000)
  force.unref()
}
function scheduleRestart() {
  if (stopping || restarting) return
  clearTimeout(restartTimer)
  restartTimer = setTimeout(() => {
    restarting = true
    backend.kill('SIGTERM')
  }, 150)
}
backend = startBackend()
launch(['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], 'vite')
// Poll only backend source files. Avoid native recursive watchers/EMFILE, and
// never restart on SQLite WAL changes or front-end edits.
function watchSources() {
  for (const file of [...readdirSync('server').filter(f => f.endsWith('.ts')).map(f => resolve('server', f)), ...readdirSync('src/lib').filter(f => f.endsWith('.ts')).map(f => resolve('src/lib',f))]) {
    if (watched.has(file)) continue
    watched.add(file)
    watchFile(file, { interval: 500, persistent: false }, (current, previous) => {
      if (current.mtimeMs !== previous.mtimeMs) scheduleRestart()
    })
  }
}
watchSources()
discovery=setInterval(watchSources,1000)
discovery.unref()
process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())
