// Tiny file logger: DOJO_HOME/logs/server.log, rotated to server.log.1 at 5 MB.
import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const LOG_ROTATE_BYTES = 5 * 1024 * 1024

export function createLogger(home, maxBytes = LOG_ROTATE_BYTES) {
  const file = join(home, 'logs', 'server.log')
  mkdirSync(dirname(file), { recursive: true })
  return {
    file,
    log(line) {
      try {
        let size = 0
        try { size = statSync(file).size } catch { /* first write */ }
        if (size >= maxBytes) {
          rmSync(`${file}.1`, { force: true })
          renameSync(file, `${file}.1`)
        }
        appendFileSync(file, `${new Date().toISOString()} ${line}\n`)
      } catch { /* logging must never take the server down */ }
    },
  }
}
