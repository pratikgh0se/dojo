// Ports for the dev server, Playwright and the prototype parity server. Parallel worktrees run
// side by side (overnight program: chain F 8790, H 8792, D 8793, P 8794, B 8795), so every
// config reads the port from the environment and fails fast on junk instead of drifting.
//
// C3: 8787 belongs to the real app (Dojo.app, serving ~/Dojo) and nothing else. Dev and tests
// default to 8790 and refuse 8787 outright, so they can never talk to the real database.
type Env = Record<string, string | undefined>

export const REAL_APP_PORT = 8787
export const DEFAULT_DOJO_PORT = 8790
export const DEFAULT_PARITY_PORT = 5055
const MIN_PORT = 1024
const MAX_PORT = 65535

function readPort(env: Env, name: string, fallback: number): number {
  const raw = env[name]
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  if (!/^\d+$/.test(raw) || n < MIN_PORT || n > MAX_PORT) {
    throw new Error(`${name} must be an integer ${MIN_PORT}–${MAX_PORT}, got "${raw}"`)
  }
  return n
}

export function dojoPort(env: Env = process.env): number {
  const port = readPort(env, 'DOJO_PORT', DEFAULT_DOJO_PORT)
  if (port === REAL_APP_PORT) {
    throw new Error(`DOJO_PORT ${REAL_APP_PORT} is reserved for the real Dojo app (~/Dojo); dev and tests use ${DEFAULT_DOJO_PORT}+`)
  }
  return port
}

export function dojoBaseUrl(env: Env = process.env): string {
  return `http://127.0.0.1:${dojoPort(env)}`
}

export function parityPort(env: Env = process.env): number {
  return readPort(env, 'DOJO_PARITY_PORT', DEFAULT_PARITY_PORT)
}

export function parityBaseUrl(env: Env = process.env): string {
  return `http://127.0.0.1:${parityPort(env)}`
}
