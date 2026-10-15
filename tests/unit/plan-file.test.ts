// @vitest-environment node
//
// N4 / LAUNCH-13 / PATH-30: DOJO_PLAN_FILE serves a tester's plan in place of the build's own.
// (Node environment: this imports vite.config.ts, see ports.test.ts.)
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDojoServer, readServerConfig } from '../../server/dojo-server.mjs'
import { PlanFileError, planFileSetting, readPlanFile, resolvePlanFile } from '../../server/plan-file.mjs'
import { overlayPlan } from '../../server/profile.mjs'
import { planFile } from '../../vite.config'
import { runReconcile } from '../../src/data/seed'
import { getSettings } from '../../src/data/db'
import { freshDb } from '../helpers/db'
import { flatPlanV2 } from '../helpers/plan'

// DOJO_PLAN_FILE validates the plan's shape (a planVersion and a plan v2), so the stand-ins are real plans.
const DEFAULT_PLAN = { ...flatPlanV2, planVersion: 'build-own', schedule: { restDay: 'default rest' } }
const TESTER_PLAN = { ...flatPlanV2, planVersion: 'tester-2', schedule: { restDay: 'tester rest' } }

let tmp: string
let planPath: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'dojo-planfile-'))
  planPath = join(tmp, 'plan.copy.json')
  writeFileSync(planPath, JSON.stringify(TESTER_PLAN))
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('readPlanFile / planFileSetting', () => {
  it('treats unset and empty as no plan file', () => {
    expect(planFileSetting({})).toBeNull()
    expect(planFileSetting({ DOJO_PLAN_FILE: '' })).toBeNull()
    expect(planFileSetting({ DOJO_PLAN_FILE: planPath })).toBe(planPath)
  })
  it('returns the file text', () => {
    expect(JSON.parse(readPlanFile(planPath))).toEqual(TESTER_PLAN)
  })
  it.each([
    ['a missing file', () => join(tmp, 'nope.json'), /DOJO_PLAN_FILE.*nope\.json.*(not found|cannot be read)/],
    ['a relative path', () => 'plan.json', /DOJO_PLAN_FILE.*absolute/],
    ['a directory', () => tmp, /DOJO_PLAN_FILE.*not a file/],
    ['invalid JSON', () => { const f = join(tmp, 'bad.json'); writeFileSync(f, '{ not json'); return f }, /DOJO_PLAN_FILE.*not valid JSON/],
    ['JSON that is not an object', () => { const f = join(tmp, 'arr.json'); writeFileSync(f, '[1]'); return f }, /DOJO_PLAN_FILE.*JSON object/],
  ])('throws a message naming the variable for %s', (_n, path, re) => {
    expect(() => readPlanFile(path())).toThrow(re)
  })
})

describe('npm run dev (scripts/dev.mjs) validates DOJO_PLAN_FILE before starting anything', () => {
  const dev = (env: Record<string, string>) =>
    spawnSync(process.execPath, ['scripts/dev.mjs'], {
      env: { ...process.env, DOJO_HOME: join(tmp, 'home'), DOJO_PORT: '8898', DOJO_SERVER_PORT: '8899', ...env }, encoding: 'utf8', timeout: 15_000,
    })
  it('a missing file prints a message and exits 1', () => {
    const r = dev({ DOJO_PLAN_FILE: join(tmp, 'missing.json') })
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/DOJO_PLAN_FILE/)
    expect(r.stderr).toMatch(/missing\.json/)
  })
  it('an invalid JSON file prints a message and exits 1', () => {
    const bad = join(tmp, 'bad.json')
    writeFileSync(bad, '{ nope')
    const r = dev({ DOJO_PLAN_FILE: bad })
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/DOJO_PLAN_FILE.*not valid JSON/)
  })
})

describe('dev server: the planFile Vite plugin', () => {
  type Mw = (req: { url?: string; method?: string }, res: { setHeader(k: string, v: string): void; statusCode: number; end(b?: unknown): void }, next: () => void) => void
  function call(plugin: ReturnType<typeof planFile>, url: string, method = 'GET') {
    const mws: Mw[] = []
    ;(plugin.configureServer as (s: unknown) => void)({ middlewares: { use: (f: Mw) => mws.push(f) } })
    const out = { status: 200, body: '', headers: {} as Record<string, string>, nexted: false }
    mws[0]({ url, method }, { setHeader: (k, v) => { out.headers[k] = v }, set statusCode(v: number) { out.status = v }, get statusCode() { return out.status }, end: b => { out.body = String(b ?? '') } }, () => { out.nexted = true })
    return out
  }
  it('serves the plan file at /data/plan.json, re-read on every request', () => {
    const p = planFile({ DOJO_PLAN_FILE: planPath })
    expect(JSON.parse(call(p, '/data/plan.json').body)).toEqual(TESTER_PLAN)
    writeFileSync(planPath, JSON.stringify({ ...TESTER_PLAN, planVersion: 'edited-3' }))
    const r = call(p, '/data/plan.json?x=1')
    expect(JSON.parse(r.body).planVersion).toBe('edited-3')
    expect(r.headers['Content-Type']).toBe('application/json')
    expect(r.nexted).toBe(false)
  })
  it('lays DOJO_HOME/profile.json over the file (the server profile overlay)', () => {
    const home = join(tmp, 'home')
    mkdirSync(home)
    writeFileSync(join(home, 'profile.json'), JSON.stringify({ plan: { schedule: { restDay: 'profile rest' } } }))
    const got = JSON.parse(call(planFile({ DOJO_PLAN_FILE: planPath, DOJO_HOME: home }), '/data/plan.json').body)
    expect(got).toMatchObject({ planVersion: 'tester-2', schedule: { restDay: 'profile rest' } })
  })
  it('answers 500 with the message when the file has gone bad after start', () => {
    const p = planFile({ DOJO_PLAN_FILE: planPath })
    writeFileSync(planPath, '{ broken')
    const r = call(p, '/data/plan.json')
    expect(r.status).toBe(500)
    expect(r.body).toMatch(/DOJO_PLAN_FILE.*not valid JSON/)
  })
  it('ignores other paths and other methods, and does nothing at all when unset', () => {
    const p = planFile({ DOJO_PLAN_FILE: planPath })
    expect(call(p, '/data/other.json').nexted).toBe(true)
    expect(call(p, '/data/plan.json', 'POST').nexted).toBe(true)
    expect(call(planFile({}), '/data/plan.json').nexted).toBe(true)
  })
})

describe('dojo-server --dist: GET /data/plan.json', () => {
  let home: string
  let dist: string
  let s: ReturnType<typeof createDojoServer> | null = null
  async function start(env: Record<string, string> = {}) {
    s = createDojoServer(readServerConfig(['--fake', '--dist', dist], { DOJO_HOME: home, DOJO_PORT: '0', ...env }))
    return `http://127.0.0.1:${await s.listen(0)}`
  }
  beforeEach(() => {
    home = join(tmp, 'srv-home')
    dist = join(tmp, 'dist')
    mkdirSync(join(dist, 'data'), { recursive: true })
    writeFileSync(join(dist, 'index.html'), '<html>app</html>')
    writeFileSync(join(dist, 'data', 'plan.json'), JSON.stringify(DEFAULT_PLAN))
  })
  afterEach(async () => { await s?.close(); s = null })

  it('serves the plan file instead of the build\'s own, re-read per request', async () => {
    const base = await start({ DOJO_PLAN_FILE: planPath })
    const r = await fetch(base + '/data/plan.json')
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toContain('application/json')
    expect(r.headers.get('cache-control')).toBe('no-cache')
    expect(await r.json()).toEqual(TESTER_PLAN)
    writeFileSync(planPath, JSON.stringify({ ...TESTER_PLAN, planVersion: 'edited-3' }))
    expect((await (await fetch(base + '/data/plan.json')).json()).planVersion).toBe('edited-3')
  })
  it('keeps the profile overlay on top of the plan file', async () => {
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, 'profile.json'), JSON.stringify({ plan: { schedule: { restDay: 'profile rest' } } }))
    const base = await start({ DOJO_PLAN_FILE: planPath })
    expect(await (await fetch(base + '/data/plan.json')).json()).toEqual({ ...TESTER_PLAN, schedule: { restDay: 'profile rest' } })
  })
  it('unset (or empty) serves the build\'s own plan', async () => {
    const base = await start({ DOJO_PLAN_FILE: '' })
    expect(await (await fetch(base + '/data/plan.json')).json()).toEqual(DEFAULT_PLAN)
  })
  it('refuses to start with a missing or invalid file (config error naming the variable)', () => {
    expect(() => readServerConfig(['--fake', '--dist', dist], { DOJO_HOME: join(tmp, 'h1'), DOJO_PORT: '0', DOJO_PLAN_FILE: join(tmp, 'missing.json') })).toThrow(/DOJO_PLAN_FILE/)
    writeFileSync(join(tmp, 'bad.json'), '{ nope')
    expect(() => readServerConfig(['--fake', '--dist', dist], { DOJO_HOME: join(tmp, 'h2'), DOJO_PORT: '0', DOJO_PLAN_FILE: join(tmp, 'bad.json') })).toThrow(/not valid JSON/)
  })
  it('answers HEAD for the plan file like GET (headers of the file, no body)', async () => {
    const base = await start({ DOJO_PLAN_FILE: planPath })
    const r = await fetch(base + '/data/plan.json', { method: 'HEAD' })
    expect(r.status).toBe(200)
    expect(Number(r.headers.get('content-length'))).toBe(Buffer.byteLength(JSON.stringify(TESTER_PLAN)))
    expect(await r.text()).toBe('')
  })
  it('answers 500 with the message when the file goes bad while running', async () => {
    const base = await start({ DOJO_PLAN_FILE: planPath })
    writeFileSync(planPath, '{ broken')
    const r = await fetch(base + '/data/plan.json')
    expect(r.status).toBe(500)
    expect(await r.text()).toMatch(/DOJO_PLAN_FILE.*not valid JSON/)
  })
})

describe('PATH-30 rules half: a plan refresh keeps overrides', () => {
  it('a changed planVersion and changed order updates planVersion and order but keeps orderOverride', async () => {
    const d = freshDb()
    await runReconcile(d, flatPlanV2)
    // three overridden DSA problems; m1w1i1 is another DSA-lane ticket without an override
    const overridden = ['p200', 'p127', 'p1']
    for (const [i, id] of overridden.entries()) await d.tickets.update(id, { orderOverride: 0.1 + i / 10 })
    const before = Object.fromEntries((await d.tickets.toArray()).map(t => [t.id, t]))

    // the tester's copy of GET /data/plan.json: new planVersion, new order for the three and for one other DSA ticket
    const next = JSON.parse(JSON.stringify(flatPlanV2))
    next.planVersion = 'tester-2'
    const newOrder: Record<number, number> = { 200: 20, 127: 21, 1: 22 }
    for (const p of next.dsa_bank[0].problems) p.order = newOrder[p.num]
    next.tasks.find((t: { id: string }) => t.id === 'm1w1i1').order = 23
    await runReconcile(d, next)

    expect((await getSettings(d)).planVersion).toBe('tester-2')
    expect(await d.tickets.get('p200')).toMatchObject({ order: 20, orderOverride: before.p200.orderOverride })
    expect(await d.tickets.get('p127')).toMatchObject({ order: 21, orderOverride: before.p127.orderOverride })
    expect(await d.tickets.get('p1')).toMatchObject({ order: 22, orderOverride: before.p1.orderOverride })
    const other = (await d.tickets.get('m1w1i1'))!
    expect(other.order).toBe(23)
    expect(other.orderOverride).toBeUndefined()
    expect(before.p200.order).not.toBe(20)
  })
})

describe('--real (the installed Dojo.app) ignores DOJO_PLAN_FILE', () => {
  const realCfg = (env: Record<string, string>) => readServerConfig(['--real', '--dist', join(tmp, 'dist')], { HOME: join(tmp, 'fakehome'), ...env })
  it('a missing or invalid file does not stop the server and is not served', () => {
    writeFileSync(join(tmp, 'bad.json'), '{ nope')
    for (const f of [join(tmp, 'missing.json'), join(tmp, 'bad.json'), 'relative.json']) {
      let cfg: ReturnType<typeof realCfg> | undefined
      expect(() => { cfg = realCfg({ DOJO_PLAN_FILE: f }) }, f).not.toThrow()
      expect(cfg!.planFile).toBeNull()
    }
  })
  it('a valid file is not served either, and one stderr line says it is ignored', () => {
    const lines: string[] = []
    const orig = process.stderr.write.bind(process.stderr)
    process.stderr.write = ((c: string | Uint8Array) => { lines.push(String(c)); return true }) as typeof process.stderr.write
    try {
      expect(realCfg({ DOJO_PLAN_FILE: planPath }).planFile).toBeNull()
      expect(realCfg({ DOJO_PLAN_FILE: '' }).planFile).toBeNull()
    } finally { process.stderr.write = orig }
    expect(lines.filter(l => /DOJO_PLAN_FILE.*ignored.*--real/.test(l))).toHaveLength(1)
  })
  it('non-real modes still validate and keep the path', () => {
    expect(readServerConfig(['--fake'], { DOJO_HOME: join(tmp, 'h'), DOJO_PORT: '0', DOJO_PLAN_FILE: planPath }).planFile).toBe(planPath)
  })
})

// ---- the plan-file validation suite from S1 (plan v2 / v1 shape, planVersion, one-line reasons) ----
let dir = ''
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'dojo-planfile-v-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const v2 = () => JSON.parse(readFileSync(join(__dirname, '../fixtures/plan.small.v2.json'), 'utf8'))
// a v1 plan (an array `sprints`): launch.md makes any non-v2 file invalid, so it is rejected
const v1 = () => ({ planVersion: 'v1-shape', sprints: [], dsa_bank: [], design_bank: [] })
const put = (name: string, content: unknown) => {
  const p = join(dir, name)
  writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content))
  return p
}
const reason = (env: Record<string, string>) => { try { resolvePlanFile(env) } catch (e) { return (e as Error).message } return null }

describe('resolvePlanFile', () => {
  it('is null when DOJO_PLAN_FILE is unset or empty', () => {
    expect(resolvePlanFile({})).toBeNull()
    expect(resolvePlanFile({ DOJO_PLAN_FILE: '' })).toBeNull()
  })

  it('accepts a v2 plan, returning the path and the parsed json; a v1 plan is a PlanFileError naming only v2', () => {
    const p2 = put('v2.json', v2())
    const r2 = resolvePlanFile({ DOJO_PLAN_FILE: p2 })
    expect(r2?.path).toBe(p2)
    expect(r2?.json.planVersion).toBe(v2().planVersion)
    const p1 = put('old-plan.json', v1())
    expect(() => resolvePlanFile({ DOJO_PLAN_FILE: p1 })).toThrow(PlanFileError)
    expect(() => readPlanFile(p1)).toThrow(/is not a plan v2 \(planFormat 2 with arrays areas, phases, nodes, tickets\)$/)
    expect(reason({ DOJO_PLAN_FILE: p1 })).toBe(`DOJO_PLAN_FILE: ${p1} is not a plan v2 (planFormat 2 with arrays areas, phases, nodes, tickets)`)
  })

  it('names the reason, on one line, for each bad file', () => {
    const bad: Record<string, string | null> = {
      relative: 'plans/x.json',
      missing: join(dir, 'nope.json'),
      notJson: put('a.json', '{ nope'),
      array: put('b.json', '[1]'),
      noVersion: put('c.json', { ...v2(), planVersion: undefined }),
      emptyVersion: put('d.json', { ...v2(), planVersion: '' }),
      numVersion: put('e.json', { ...v2(), planVersion: 3 }),
      notAPlan: put('f.json', { planVersion: 'x', hello: 1 }),
      v2WrongFormat: put('g.json', { ...v2(), planFormat: 3, sprints: undefined }),
      v2MissingTickets: put('h.json', { ...v2(), tickets: 'no' }),
    }
    const want: Record<string, RegExp> = {
      relative: /absolute/, missing: /cannot read .*ENOENT/, notJson: /not valid JSON/, array: /not a JSON object/,
      noVersion: /planVersion/, emptyVersion: /planVersion/, numVersion: /planVersion/, notAPlan: /not a plan/,
      v2WrongFormat: /not a plan/, v2MissingTickets: /not a plan/,
    }
    for (const [k, path] of Object.entries(bad)) {
      const m = reason({ DOJO_PLAN_FILE: path! })
      expect(m, k).toMatch(want[k])
      expect(m, k).not.toContain('\n')
    }
  })

  it('a directory is unreadable, not a crash', () => {
    expect(reason({ DOJO_PLAN_FILE: dir })).toMatch(/cannot read/)
  })
})

describe('overlayPlan on a v2 plan', () => {
  it('lays schedule and learner over it, leaves every other key alone, and is a no-op without them', () => {
    const text = JSON.stringify(v2())
    expect(overlayPlan(text, {})).toBe(text)
    const out = JSON.parse(overlayPlan(text, { plan: { schedule: { restDay: 'mine' }, learner: { patternsRepo: 'https://e.x' } } }))
    expect(out.schedule).toEqual({ restDay: 'mine' })
    expect(out.learner).toEqual({ patternsRepo: 'https://e.x' })
    expect({ ...out, schedule: undefined, learner: undefined }).toEqual({ ...v2(), schedule: undefined, learner: undefined })
  })
})
