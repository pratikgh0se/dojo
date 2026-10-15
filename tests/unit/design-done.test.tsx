import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createDb, syncGate } from '../../src/data/db'
import type { DesignSession } from '../../src/data/types'
import { READ_ONLY_MESSAGE } from '../../src/data/writer'
import { emptyNotes } from '../../src/rules/designNotes'
import { setNow } from '../../src/lib/clock'
import { DesignSessionScreen } from '../../src/screens/designSession/DesignSessionScreen'
import { seededDb } from '../helpers/db'
import { flatPlanV2 } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const T = ist('2026-10-11T11:00:00')
const MIN = 60_000
const S1_CANVAS = {
  layout: 'manual',
  nodes: [
    { id: 'gateway-1', kind: 'gateway', label: 'Gateway 1', x: 1, y: 1 }, { id: 'service-1', kind: 'service', label: 'Service 1', x: 7, y: 1 },
    { id: 'cache-1', kind: 'cache', label: 'Cache 1', x: 13, y: 1 }, { id: 'sql-1', kind: 'sql', label: 'Sql 1', x: 19, y: 1 },
  ],
  links: [
    { from: 'gateway-1', to: 'service-1', kind: 'async' }, { from: 'service-1', to: 'cache-1', kind: 'sync' },
    { from: 'service-1', to: 'sql-1', kind: 'write' },
  ],
  zones: [], flows: [],
}
const REF = {
  layout: 'layered',
  nodes: [
    { id: 'client', kind: 'browser', label: 'Client' }, { id: 'gw', kind: 'gateway', label: 'Gateway' },
    { id: 'svc', kind: 'service', label: 'Service' }, { id: 'store', kind: 'nosql', label: 'Counters' },
  ],
  links: [{ from: 'client', to: 'gw', kind: 'sync' }, { from: 'gw', to: 'svc', kind: 'sync' }, { from: 'svc', to: 'store', kind: 'write' }],
  zones: [], flows: [{ path: ['client', 'gw', 'svc', 'store'], packet: 'request', label: 'hot path' }],
}

async function done(extra: Partial<DesignSession> = {}, others: Partial<DesignSession>[] = []) {
  setNow(() => T)
  const d = await seededDb()
  const row = {
    id: 'ds-1', designId: 'd-method', at: T - 60 * MIN, phase: 'done', endedAt: T - 5 * MIN, lockedAt: T - 48 * MIN, minutes: 12,
    mode: 'solo', view: '2d', canvas: S1_CANVAS,
    close: { tradeoff: { chose: 'a', over: 'b', because: 'c' }, breaksAt10x: 'x', dataOwnership: 'y', couldNotAnswer: 1, readNext: 'DDIA' },
    deepDives: [2, 1, 2, 0].map((answered, i) => ({ q: ['Requirements', 'API first', 'One deep dive', 'Failure modes'][i], answered })),
    tradeoffs: [{ chose: 'a', over: 'b', because: 'c' }, { chose: 'd', over: 'e', because: 'f' }], rubric: 12, rubricBy: 'self',
    lenses: { load: 2, data: 1, consistency: 1, failure: 0, latency: 2, cost: 1, evolution: 1 }, redesignDue: ist('2026-11-10T00:00:00'),
    ...extra,
  } as DesignSession
  await d.designSessions.add(row)
  for (const o of others) await d.designSessions.add({ ...row, reference: REF as never, ...o } as DesignSession)
  renderWithApp(<DesignSessionScreen />, { db: d, plan: flatPlanV2, route: '/designs/session/d-method?session=ds-1', path: '/designs/session/:designId' })
  await screen.findByTestId('session-summary')
  return d
}
const items = (id: string) => within(screen.getByTestId(id)).queryAllByTestId('session-diff-item').map(e => e.textContent)

afterEach(() => { localStorage.clear(); syncGate.readOnly = false })

describe('Done view (C-DESIGN §4.8)', () => {
  it('draws the reference once, beside yours, with a diff (D-39, D-40)', async () => {
    localStorage.setItem('dojo-ai-fake-delay-ms', '30')
    const d = await done()
    expect(screen.getByTestId('session-reference-loading')).toBeInTheDocument()
    const ref = screen.getByRole('region', { name: 'Reference' })
    await waitFor(() => expect(within(ref).getByRole('button', { name: 'JSON' })).toBeInTheDocument())
    expect(screen.queryByTestId('session-reference-loading')).toBeNull()
    expect(screen.getByRole('region', { name: 'Your diagram' })).toHaveAttribute('data-testid', 'session-yours')
    expect(screen.queryByTestId('kit-node-gateway-1')).toBeNull()
    fireEvent.click(within(ref).getByRole('button', { name: 'JSON' }))
    expect(JSON.parse(screen.getByTestId('session-reference-json').textContent ?? '')).toEqual(REF)
    expect((await d.designSessions.get('ds-1'))?.reference).toEqual(REF)
    const diff = screen.getByRole('region', { name: 'Differences' })
    expect(diff).toHaveTextContent('Information, not a score.')
    expect(items('session-diff-mine')).toEqual(['cache (Cache 1)', 'sql (Sql 1)'])
    expect(items('session-diff-ref')).toEqual(['browser (Client)', 'nosql (Counters)'])
    expect(items('session-diff-links')).toEqual(['gateway → service: yours async, reference sync'])
    expect(screen.getByTestId('session-summary')).toHaveTextContent('rubric 12 / 20')
  })

  it('uses the stored reference without calling the AI again (D-41)', async () => {
    localStorage.setItem('dojo-ai-fake-fail', '*')
    await done({ reference: REF as never })
    expect(screen.queryByTestId('session-reference-loading')).toBeNull()
    expect(within(screen.getByRole('region', { name: 'Reference' })).getByRole('button', { name: 'Play flows' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByTestId('session-ai-error')).toBeNull()
  })

  it('toggles Play flows and offers both exports (D-42, D-44)', async () => {
    await done({ reference: REF as never })
    const play = screen.getByRole('button', { name: 'Play flows' })
    fireEvent.click(play)
    expect(play).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(play)
    expect(play).toHaveAttribute('aria-pressed', 'false')
    expect(within(screen.getByTestId('session-yours')).getByRole('button', { name: 'Export PNG' })).toBeInTheDocument()
    expect(within(screen.getByTestId('session-reference')).getByRole('button', { name: 'Export reference PNG' })).toBeInTheDocument()
  })

  it('shows the raw error and Retry when the reference fails (Review Focus #5)', async () => {
    localStorage.setItem('dojo-ai-fake-fail', 'diagram')
    await done()
    const ref = screen.getByRole('region', { name: 'Reference' })
    expect(await within(ref).findByText(/fake diagram unavailable/)).toBeInTheDocument()
    expect(screen.queryByTestId('session-diff')).toBeNull()
    localStorage.removeItem('dojo-ai-fake-fail')
    fireEvent.click(within(ref).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.getByTestId('session-diff')).toBeInTheDocument())
  })

  it('keeps the interviewer transcript and grade (D-38)', async () => {
    const final = {
      done: true, score: 15, oneThingToStudy: '[fake:interview] d-method', deepDives: [2, 1, 2, 1],
      lenses: { load: 2, data: 1, consistency: 1, failure: 1, latency: 1, cost: 0, evolution: 1 },
      perItem: [{ item: 'Requirements and numbers', points: 4, note: 'n' }],
    }
    await done({
      mode: 'interviewer', reference: REF as never,
      interview: { messages: [{ from: 'interviewer', text: 'q0' }, { from: 'you', text: 'a1' }, { from: 'interviewer', text: 'q1' }], final } as never,
    })
    expect(screen.getByText('Conversation', { selector: 'summary' })).toBeInTheDocument()
    expect(screen.getAllByTestId('session-msg')).toHaveLength(3)
    // GLOBAL-01: the stored line says interview; the screen says session
    expect(screen.getByTestId('session-grade')).toHaveTextContent('One thing to study: [fake:session] d-method')
  })

  it('draws the engine diagram from toEngineJson: a custom box wears its glyph and sub, a linked table block takes the table name and columns (F1/T3/T19)', async () => {
    await done({
      reference: REF as never,
      canvas: {
        layout: 'manual',
        nodes: [
          { id: 'custom-1', kind: 'custom', label: 'Render engine', glyph: 'process', sub: 'Composites tiles', x: 1, y: 1 },
          { id: 'table-1', kind: 'table', label: 'layers', schemaId: 's1', x: 7, y: 1 },
        ],
        links: [{ from: 'custom-1', to: 'table-1', kind: 'write' }], zones: [], flows: [],
      } as never,
      notes: { ...emptyNotes(), schema: [{ id: 's1', name: 'layers', cols: [{ name: 'doc_id', type: 'uuid', key: 'FK' }] }] },
    })
    const el = within(screen.getByTestId('session-yours')).getByRole('group', { name: 'Your diagram, read-only' })
    const data = JSON.parse(el.getAttribute('data') ?? '{}') as { nodes: { id: string; kind: string; label: string; sub?: string; fields?: string[] }[] }
    expect(data.nodes.find(n => n.id === 'custom-1')).toMatchObject({ kind: 'process', label: 'Render engine', sub: 'Composites tiles' })
    const table = data.nodes.find(n => n.id === 'table-1')
    expect(table).toMatchObject({ kind: 'table', label: 'layers' })
    expect(table?.fields?.length).toBe(1)
    // the diff reads engine kinds too: a custom box drawn as a process is a "process", not an unknown "custom"
    expect(items('session-diff-mine').join(' ')).toContain('process (Render engine)')
    expect(items('session-diff-mine').join(' ')).not.toContain('custom')
  })

  it('says the word interview nowhere: not in text, not in an aria-label', async () => {
    const final = {
      done: true, score: 15, oneThingToStudy: 'Partitioning.', deepDives: [2, 1, 2, 1],
      lenses: { load: 2, data: 1, consistency: 1, failure: 1, latency: 1, cost: 0, evolution: 1 },
      perItem: [{ item: 'Requirements and numbers', points: 4, note: 'n' }],
    }
    await done({ mode: 'interviewer', reference: REF as never, interview: { messages: [{ from: 'interviewer', text: 'q0' }], final } as never })
    expect(document.body.textContent).not.toMatch(/interview/i)
    expect(document.body.innerHTML).not.toMatch(/aria-label="[^"]*interview/i)
    expect(screen.getByRole('region', { name: 'Grade' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Grade' })).toBeInTheDocument()
  })
})

describe('Done view accent and redo (DESIGN-73, 74)', () => {
  it('shows session-redesign-due and the one accent REDO · DESIGN only when a redesign is due', async () => {
    await done({ reference: REF as never })
    expect(screen.getByTestId('session-redesign-due')).toHaveTextContent('Redesign due 2026-11-10')
    const redo = screen.getByTestId('session-redesign')
    expect(redo).toHaveTextContent(/^REDO · DESIGN$/)
    expect(redo).toHaveAttribute('data-accent', 'primary')
    expect(document.querySelectorAll('[data-accent="primary"]')).toHaveLength(1)
  })

  it('has no redo button, no due paragraph and no accent when nothing is due', async () => {
    await done({ reference: REF as never, redesignDue: undefined })
    expect(screen.queryByTestId('session-redesign')).toBeNull()
    expect(screen.queryByTestId('session-redesign-due')).toBeNull()
    expect(document.querySelectorAll('[data-accent="primary"]')).toHaveLength(0)
  })

  it('REDO · DESIGN starts a new drawing session at once, same mode, redesignOf set, empty notes, and shows session-diff beside the work', async () => {
    const d = await done({ mode: 'interviewer', reference: REF as never })
    fireEvent.click(screen.getByTestId('session-redesign'))
    await screen.findByTestId('session-close-design')
    expect(screen.queryByTestId('session-setup')).toBeNull()
    expect(screen.getByTestId('location')).toHaveAttribute('data-search', '')
    const rows = await d.designSessions.where('designId').equals('d-method').toArray()
    expect(rows).toHaveLength(2)
    const fresh = rows.find(r => r.id !== 'ds-1')!
    expect(fresh).toMatchObject({ phase: 'drawing', mode: 'ai-partner', redesignOf: 'ds-1' })
    expect(fresh.notes).toEqual(emptyNotes())
    expect(fresh.notes?.schema).toEqual([])
    expect(await screen.findByTestId('session-diff')).toBeInTheDocument()
    expect(items('session-diff-mine').length + items('session-diff-ref').length).toBeGreaterThan(0)
  })
})

describe('Done view reference policy per mode (DESIGN-54, F1 ruling, Task 19b)', () => {
  it.each(['solo', 'ai-partner'] as const)('%s still draws the reference through the diagram job once', async mode => {
    const d = await done({ mode })
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Reference' })).getByRole('button', { name: 'JSON' })).toBeInTheDocument())
    expect((await d.aiLog.toArray()).map(r => r.job)).toEqual(['diagram'])
    expect(screen.queryByTestId('session-reference-none')).toBeNull()
  })

  it('human-partner makes no AI call: one sentence in session-reference, no loader, retry, error, hint or chat', async () => {
    const d = await done({ mode: 'human-partner', partner: {} as never })
    await new Promise(r => setTimeout(r, 40))
    expect(await d.aiLog.count()).toBe(0)
    const ref = screen.getByTestId('session-reference')
    expect(ref).toHaveTextContent('The reference diagram needs the AI; this session used none.')
    expect(within(ref).queryByRole('button', { name: 'JSON' })).toBeNull()
    for (const id of ['ai-loader', 'session-reference-loading', 'ai-retry', 'session-ai-error', 'session-hint', 'session-chat-input', 'session-diff']) {
      expect(screen.queryByTestId(id), id).toBeNull()
    }
    expect(screen.queryAllByRole('button').filter(b => /grade.*AI|AI.*grade/i.test(b.getAttribute('aria-label') ?? b.textContent ?? ''))).toHaveLength(0)
    expect((await d.designSessions.get('ds-1'))?.reference).toBeUndefined()
  })

  it('a human-partner session that already holds a reference still shows it, without calling the AI', async () => {
    const d = await done({ mode: 'human-partner', partner: {} as never, reference: REF as never })
    expect(within(screen.getByRole('region', { name: 'Reference' })).getByRole('button', { name: 'Play flows' })).toBeInTheDocument()
    expect(screen.queryByTestId('session-reference-none')).toBeNull()
    expect(await d.aiLog.count()).toBe(0)
  })

  it('redo from a human-partner session starts a human-partner drawing session and still shows session-diff (one sentence, no items)', async () => {
    const d = await done({ mode: 'human-partner', partner: {} as never })
    fireEvent.click(screen.getByTestId('session-redesign'))
    await screen.findByTestId('session-close-design')
    const fresh = (await d.designSessions.where('designId').equals('d-method').toArray()).find(r => r.id !== 'ds-1')!
    expect(fresh).toMatchObject({ phase: 'drawing', mode: 'human-partner', redesignOf: 'ds-1' })
    const diff = await screen.findByTestId('session-diff')
    expect(diff).toHaveTextContent('No reference was drawn for this session.')
    expect(within(diff).queryByTestId('session-diff-item')).toBeNull()
    expect(await d.aiLog.count()).toBe(0)
  })
})


describe('Done view carry-overs: Retry hook, redo target, redo errors', () => {
  it('a failed reference shows the raw error with ai-retry, and Retry draws it', async () => {
    localStorage.setItem('dojo-ai-fake-fail', 'diagram')
    const d = await done()
    const ref = screen.getByTestId('session-reference')
    const retry = await within(ref).findByTestId('ai-retry')
    expect(screen.getByTestId('session-ai-error')).toBeInTheDocument()
    localStorage.removeItem('dojo-ai-fake-fail')
    fireEvent.click(retry)
    await waitFor(() => expect(within(ref).getByRole('button', { name: 'JSON' })).toBeInTheDocument())
    expect(screen.queryByTestId('ai-retry')).toBeNull()
    expect((await d.designSessions.get('ds-1'))?.reference).toEqual(REF)
  })

  it('REDO · DESIGN names the session being viewed, not an older or a newer outstanding one', async () => {
    const d = await done({ reference: REF as never }, [
      { id: 'ds-0', at: T - 3 * 24 * 60 * MIN, endedAt: T - 3 * 24 * 60 * MIN + MIN },
      { id: 'ds-2', at: T + 24 * 60 * MIN, endedAt: T + 24 * 60 * MIN + MIN },
    ])
    fireEvent.click(screen.getByTestId('session-redesign'))
    await screen.findByTestId('session-close-design')
    const fresh = (await d.designSessions.where('designId').equals('d-method').toArray()).find(r => r.phase !== 'done')!
    expect(fresh.redesignOf).toBe('ds-1')
  })

  it('REDO · DESIGN in a read-only browser shows the Read-only toast and stays on the finished session (no unhandled rejection)', async () => {
    const gate = { bypass: true, readOnly: true }
    const d = createDb(`ro-done-${Math.random().toString(36).slice(2)}`, gate)
    setNow(() => T)
    await d.designSessions.add({
      id: 'ds-1', designId: 'd-method', at: T - 60 * MIN, phase: 'done', endedAt: T - 5 * MIN, lockedAt: T - 48 * MIN, minutes: 12, mode: 'solo', view: '2d',
      canvas: S1_CANVAS, close: { tradeoff: { chose: 'a', over: 'b', because: 'c' }, breaksAt10x: 'x', dataOwnership: 'y', couldNotAnswer: 1, readNext: 'DDIA' },
      deepDives: [2, 1, 2, 0].map(answered => ({ q: 'q', answered })), tradeoffs: [], rubric: 12, rubricBy: 'self', lenses: {},
      redesignDue: ist('2026-11-10T00:00:00'), reference: REF,
    } as unknown as DesignSession)
    gate.bypass = false
    const unhandled: unknown[] = []
    const onUnhandled = (e: unknown) => unhandled.push(e)
    process.on('unhandledRejection', onUnhandled)
    try {
      renderWithApp(<DesignSessionScreen />, { db: d, plan: flatPlanV2, route: '/designs/session/d-method?session=ds-1', path: '/designs/session/:designId' })
      await screen.findByTestId('session-summary')
      fireEvent.click(screen.getByTestId('session-redesign'))
      expect(await screen.findByText(READ_ONLY_MESSAGE)).toBeInTheDocument()
      await new Promise(r => setTimeout(r, 100))
      expect(unhandled).toEqual([])
      expect(screen.getByTestId('session-summary')).toBeInTheDocument()
      expect(await d.designSessions.count()).toBe(1)
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })
})
