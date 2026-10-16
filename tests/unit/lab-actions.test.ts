import { describe, expect, it } from 'vitest'
import { fetchLabInfo, getHint, runChecks, saveLabsRoot, setupLab } from '../../src/data/labActions'
import { getSettings } from '../../src/data/db'
import { freshDb } from '../helpers/db'
import { err, INFO, labServer, ok, RUN_PASS } from '../helpers/labServer'
import { mkLabRow } from '../helpers/labRows'

const NOW = new Date(2026, 10, 4, 10, 0).getTime()
const setupOk = (extra: Record<string, unknown> = {}) => ok({ status: 'created', path: '/Users/p/labs/ai-platform-lab/labs/t-lab', baseCommit: 'b'.repeat(40), ...extra })

describe('fetchLabInfo', () => {
  it('returns the definition without ok; null for an unknown lab, a dead server and a read-only browser', async () => {
    const s = labServer({ '/labs/info': () => ok({ ...INFO }) })
    expect(await fetchLabInfo('t-lab', s.f)).toEqual(INFO)
    expect(s.calls[0]).toMatchObject({ path: '/labs/info', method: 'GET', body: { labId: 't-lab' } })
    expect(await fetchLabInfo('nope', labServer({ '/labs/info': () => err(404, 'unknown_lab', 'x') }).f)).toBeNull()
    expect(await fetchLabInfo('t-lab', (() => Promise.reject(new Error('down'))) as unknown as typeof fetch)).toBeNull()
    expect(await fetchLabInfo('t-lab', labServer({ '/labs/info': () => err(403, 'not_writer', 'x') }).f)).toBeNull()
  })
})

describe('setupLab', () => {
  it('stores the labs row from the definition and the server reply, with the folder as Settings held it', async () => {
    const d = freshDb()
    const s = labServer({ '/labs/info': () => ok({ ...INFO }), '/labs/setup': () => setupOk() })
    const r = await setupLab(d, 't-lab', NOW, s.f)
    expect(r).toMatchObject({ ok: true, status: 'created', path: '/Users/p/labs/ai-platform-lab/labs/t-lab' })
    expect(await d.labs.toArray()).toEqual([{ labId: 't-lab', repo: 'ai-platform-lab', path: 'labs/t-lab', root: '~/labs', baseCommit: 'b'.repeat(40), version: 1, setupAt: NOW, hints: [] }])
    expect(s.calls.find(c => c.path === '/labs/setup')!.body).toEqual({ labId: 't-lab', labsRoot: '~/labs' })
  })

  it('sends the typed labs folder and stores it as typed', async () => {
    const d = freshDb()
    await saveLabsRoot(d, '  ~/my-labs ')
    const s = labServer({ '/labs/info': () => ok({ ...INFO }), '/labs/setup': () => setupOk() })
    await setupLab(d, 't-lab', NOW, s.f)
    expect(s.calls.find(c => c.path === '/labs/setup')!.body.labsRoot).toBe('~/my-labs')
    expect((await d.labs.get('t-lab'))!.root).toBe('~/my-labs')
  })

  it('a failure stores nothing and carries the code and the plain line (bad_root, unknown_lab, no server)', async () => {
    const d = freshDb()
    const bad = await setupLab(d, 't-lab', NOW, labServer({ '/labs/info': () => ok({ ...INFO }), '/labs/setup': () => err(400, 'bad_root', 'The labs folder must be inside your home folder, and not the home folder itself.') }).f)
    expect(bad).toEqual({ ok: false, code: 'bad_root', message: 'The labs folder must be inside your home folder, and not the home folder itself.' })
    expect(await setupLab(d, 'nope', NOW, labServer({ '/labs/info': () => err(404, 'unknown_lab', 'This lab is not available in this copy of Dojo.') }).f)).toMatchObject({ ok: false, code: 'unknown_lab' })
    expect(await setupLab(d, 't-lab', NOW, (() => Promise.reject(new Error('down'))) as unknown as typeof fetch)).toMatchObject({ ok: false, code: 'no_server' })
    expect(await d.labs.count()).toBe(0)
  })

  it('an existing folder is stored as it is; a row that exists keeps its setupAt', async () => {
    const d = freshDb()
    const exists = labServer({ '/labs/info': () => ok({ ...INFO }), '/labs/setup': () => setupOk({ status: 'exists', baseCommit: 'c'.repeat(40) }) })
    await setupLab(d, 't-lab', NOW, exists.f)
    expect((await d.labs.get('t-lab'))).toMatchObject({ baseCommit: 'c'.repeat(40), setupAt: NOW })
    await setupLab(d, 't-lab', NOW + 5000, exists.f)
    expect((await d.labs.get('t-lab'))!.setupAt).toBe(NOW)
  })

  it('set up again after the folder was deleted replaces baseCommit and setupAt and keeps the hints and the runs', async () => {
    const d = freshDb()
    await d.labs.put(mkLabRow('t-lab', { hints: [{ ticketId: 'tlab.build.1', rung: 1, at: 5 }], setupAt: 1 }))
    await d.labRuns.put({ id: 'run-t-lab-9', labId: 't-lab', at: 9, ms: 1, exit: 0, timedOut: false, results: null, tail: '' })
    const s = labServer({ '/labs/info': () => ok({ ...INFO }), '/labs/setup': () => setupOk({ baseCommit: 'd'.repeat(40) }) })
    await setupLab(d, 't-lab', NOW, s.f)
    expect(await d.labs.get('t-lab')).toMatchObject({ baseCommit: 'd'.repeat(40), setupAt: NOW, hints: [{ ticketId: 'tlab.build.1', rung: 1, at: 5 }] })
    expect(await d.labRuns.count()).toBe(1)
  })
})

describe('runChecks', () => {
  it('runs in the folder the lab was set up in (not the current Settings value) and stores the run', async () => {
    const d = freshDb()
    await d.labs.put(mkLabRow('t-lab', { root: '~/labs' }))
    await saveLabsRoot(d, '~/other-labs')
    const s = labServer({ '/labs/run': () => ok({ run: RUN_PASS }) })
    const r = await runChecks(d, 't-lab', NOW, s.f)
    expect(r.ok && r.run).toMatchObject({ id: `run-t-lab-${NOW}`, labId: 't-lab', at: NOW, exit: 0, timedOut: false })
    expect(s.calls[0].body).toEqual({ labId: 't-lab', labsRoot: '~/labs' })
    expect(await d.labRuns.count()).toBe(1)
  })
  it('I-5/LAB-09: the row at and id are the app clock of the click, not the server time in the reply', async () => {
    const d = freshDb()
    await d.labs.put(mkLabRow('t-lab'))
    const r = await runChecks(d, 't-lab', NOW + 7, labServer({ '/labs/run': () => ok({ run: { ...RUN_PASS, at: 99 } }) }).f)
    expect(r.ok && [r.run.id, r.run.at]).toEqual([`run-t-lab-${NOW + 7}`, NOW + 7])
    expect((await d.labRuns.toArray()).map(x => [x.id, x.at])).toEqual([[`run-t-lab-${NOW + 7}`, NOW + 7]])
  })
  it('a timeout and a missing results file are stored too', async () => {
    const d = freshDb()
    await d.labs.put(mkLabRow('t-lab'))
    await runChecks(d, 't-lab', NOW + 1, labServer({ '/labs/run': () => ok({ run: { at: 1, ms: 3000, exit: null, timedOut: true, results: null, tail: 'slow' } }) }).f)
    await runChecks(d, 't-lab', NOW + 2, labServer({ '/labs/run': () => ok({ run: { at: 2, ms: 10, exit: 2, timedOut: false, results: null, tail: 'crash', error: 'no_results' } }) }).f)
    expect((await d.labRuns.orderBy('at').toArray()).map(r => [r.timedOut, r.error ?? null, r.exit])).toEqual([[true, null, null], [false, 'no_results', 2]])
  })
  it('make_missing, busy, not_set_up (server and no row) and a run in a form Dojo cannot read store nothing', async () => {
    const d = freshDb()
    expect(await runChecks(d, 't-lab', NOW, labServer({}).f)).toMatchObject({ ok: false, code: 'not_set_up' })
    await d.labs.put(mkLabRow('t-lab'))
    for (const [code, status] of [['make_missing', 503], ['busy', 409], ['not_set_up', 409], ['bad_root', 400]] as const) {
      expect(await runChecks(d, 't-lab', NOW, labServer({ '/labs/run': () => err(status, code, `line ${code}`) }).f)).toEqual({ ok: false, code, message: `line ${code}` })
    }
    expect(await runChecks(d, 't-lab', NOW, labServer({ '/labs/run': () => ok({ run: { nonsense: true } }) }).f)).toMatchObject({ ok: false, code: 'server_error' })
    expect(await d.labRuns.count()).toBe(0)
  })
})

describe('getHint', () => {
  const hint = (rung: number) => ({ text: `HINT ${rung}`, ...(rung === 3 ? { ref: { file: 'notes/c1.txt', from: 1, to: 1, code: 'ok' } } : {}) })
  const server = () => labServer({ '/labs/hint': b => ok(hint(b.rung as number)) })

  it('rungs open in order; each (ticket, rung) is stored once, with the time of the click', async () => {
    const d = freshDb()
    await d.labs.put(mkLabRow('t-lab'))
    const s = server()
    expect(await getHint(d, 't-lab', 'tlab.build.1', 2, NOW, s.f)).toMatchObject({ ok: false, code: 'locked' })
    expect(s.calls).toHaveLength(0)
    expect(await getHint(d, 't-lab', 'tlab.build.1', 1, NOW, s.f)).toEqual({ ok: true, text: 'HINT 1' })
    expect(await getHint(d, 't-lab', 'tlab.build.1', 2, NOW + 1, s.f)).toMatchObject({ ok: true, text: 'HINT 2' })
    const three = await getHint(d, 't-lab', 'tlab.build.1', 3, NOW + 2, s.f)
    expect(three).toEqual({ ok: true, text: 'HINT 3', ref: { file: 'notes/c1.txt', from: 1, to: 1, code: 'ok' } })
    expect((await d.labs.get('t-lab'))!.hints).toEqual([{ ticketId: 'tlab.build.1', rung: 1, at: NOW }, { ticketId: 'tlab.build.1', rung: 2, at: NOW + 1 }, { ticketId: 'tlab.build.1', rung: 3, at: NOW + 2 }])
  })
  it('showing a stored hint again fetches it and stores nothing; rungs are per ticket', async () => {
    const d = freshDb()
    await d.labs.put(mkLabRow('t-lab', { hints: [{ ticketId: 'tlab.build.1', rung: 1, at: 5 }, { ticketId: 'tlab.build.1', rung: 2, at: 6 }, { ticketId: 'tlab.build.1', rung: 3, at: 7 }] }))
    const s = server()
    expect(await getHint(d, 't-lab', 'tlab.build.1', 3, NOW, s.f)).toMatchObject({ ok: true, text: 'HINT 3' })
    expect((await d.labs.get('t-lab'))!.hints).toHaveLength(3)
    expect(await getHint(d, 't-lab', 'tlab.build.2', 2, NOW, s.f)).toMatchObject({ ok: false, code: 'locked' })
    expect(await getHint(d, 't-lab', 'tlab.build.2', 1, NOW, s.f)).toMatchObject({ ok: true })
    expect((await d.labs.get('t-lab'))!.hints).toHaveLength(4)
  })
  it('costs nothing and calls no AI: no event, no aiLog row, no ticket or redo change; a server failure stores nothing', async () => {
    const d = freshDb()
    await d.labs.put(mkLabRow('t-lab'))
    await getHint(d, 't-lab', 'tlab.build.1', 1, NOW, server().f)
    expect(await d.events.count() + await d.aiLog.count() + await d.redos.count() + await d.rungUses.count()).toBe(0)
    expect(await getHint(d, 't-lab', 'tlab.build.1', 2, NOW, labServer({ '/labs/hint': () => err(400, 'bad_request', 'nope') }).f)).toMatchObject({ ok: false, code: 'bad_request' })
    expect((await d.labs.get('t-lab'))!.hints).toHaveLength(1)
    expect(await getHint(freshDb(), 't-lab', 'tlab.build.1', 1, NOW, server().f)).toMatchObject({ ok: false, code: 'not_set_up' })
  })
})

describe('saveLabsRoot', () => {
  it('stores the trimmed value, clears to absent, and changes nothing else', async () => {
    const d = freshDb()
    await saveLabsRoot(d, '  ~/my-labs  ')
    expect((await getSettings(d)).labsRoot).toBe('~/my-labs')
    await saveLabsRoot(d, '/tmp/x')
    expect((await getSettings(d)).labsRoot).toBe('/tmp/x') // judged at set up, not here
    await saveLabsRoot(d, '   ')
    const row = await d.settings.get('main')
    expect(row).toBeDefined()
    expect(row).not.toHaveProperty('labsRoot')
  })
})
