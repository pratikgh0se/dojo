// @vitest-environment node
// LAUNCH-13 / PATH-30: the built-app server serves DOJO_PLAN_FILE as /data/plan.json (ephemeral port, scratch home).
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDojoServer, readServerConfig } from '../../server/dojo-server.mjs'

const fixture = () => JSON.parse(readFileSync(join(__dirname, '../fixtures/plan.small.v2.json'), 'utf8'))
const ids = (plan: { tickets: { id: string }[] }) => plan.tickets.map(t => t.id)

let root = ''
let home = ''
let dist = ''
let s: ReturnType<typeof createDojoServer> | null = null
let base = ''
const DEFAULT_PLAN = { ...fixture(), planVersion: 'default-build-plan' }

async function start(env: Record<string, string> = {}) {
  s = createDojoServer(readServerConfig(['--fake', '--dist', dist], { DOJO_HOME: home, DOJO_PORT: '0', ...env }))
  base = `http://127.0.0.1:${await s.listen(0)}`
}
async function stop() { await s?.close(); s = null }

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dojo-planfile-srv-'))
  home = join(root, 'home')
  dist = join(root, 'dist')
  mkdirSync(home)
  mkdirSync(join(dist, 'data'), { recursive: true })
  writeFileSync(join(dist, 'index.html'), '<html>app</html>')
  writeFileSync(join(dist, 'data', 'plan.json'), JSON.stringify(DEFAULT_PLAN))
})
afterEach(async () => {
  await stop()
  rmSync(root, { recursive: true, force: true })
})

describe('DOJO_PLAN_FILE on the built-app server', () => {
  it('serves the chosen plan (same ticket ids, new planVersion), then the build\'s own plan again without the variable', async () => {
    const copy = join(root, 'copy.json')
    writeFileSync(copy, JSON.stringify({ ...fixture(), planVersion: 'fx-v2-changed' }))
    await start({ DOJO_PLAN_FILE: copy })
    const r = await fetch(base + '/data/plan.json')
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toContain('application/json')
    const got = await r.json()
    expect(got.planVersion).toBe('fx-v2-changed')
    expect(ids(got)).toEqual(ids(fixture()))
    await stop()

    await start()
    const own = await (await fetch(base + '/data/plan.json')).json()
    expect(own.planVersion).toBe('default-build-plan')
    expect(ids(own)).toEqual(ids(fixture()))
  })

  it('re-reads the file per request, and lays the profile overlay on top', async () => {
    const copy = join(root, 'copy.json')
    writeFileSync(copy, JSON.stringify({ ...fixture(), planVersion: 'one' }))
    writeFileSync(join(home, 'profile.json'), JSON.stringify({ plan: { schedule: { restDay: 'mine' } } }))
    await start({ DOJO_PLAN_FILE: copy })
    const a = await (await fetch(base + '/data/plan.json')).json()
    expect(a.planVersion).toBe('one')
    expect(a.schedule).toEqual({ restDay: 'mine' })
    writeFileSync(copy, JSON.stringify({ ...fixture(), planVersion: 'two' }))
    expect((await (await fetch(base + '/data/plan.json')).json()).planVersion).toBe('two')
  })

  it('serves a plan file even when the dist has no plan of its own', async () => {
    rmSync(join(dist, 'data'), { recursive: true })
    const copy = join(root, 'copy.json')
    writeFileSync(copy, JSON.stringify({ ...fixture(), planVersion: 'only' }))
    await start({ DOJO_PLAN_FILE: copy })
    expect((await (await fetch(base + '/data/plan.json')).json()).planVersion).toBe('only')
  })

  it('a bad file makes readServerConfig throw, and the entry point exit 1 with the reason on stderr', () => {
    expect(() => readServerConfig(['--fake', '--dist', dist], { DOJO_HOME: home, DOJO_PORT: '0', DOJO_PLAN_FILE: join(root, 'nope.json') })).toThrow(/cannot read/)
    const run = (planFile: string) => spawnSync(process.execPath, [join(__dirname, '../../server/dojo-server.mjs'), '--fake', '--dist', dist], {
      env: { ...process.env, DOJO_HOME: home, DOJO_PORT: '0', DOJO_PLAN_FILE: planFile }, encoding: 'utf8', timeout: 30_000,
    })
    const missing = run(join(root, 'nope.json'))
    expect(missing.status).toBe(1)
    expect(missing.stderr).toMatch(/^DOJO_PLAN_FILE: cannot read .*nope\.json/m)
    const rel = run('plans/x.json')
    expect(rel.status).toBe(1)
    expect(rel.stderr).toMatch(/^DOJO_PLAN_FILE: the path must be absolute/m)
  })
})
