import { readFileSync } from 'node:fs'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Shell } from '../../src/app/Shell'
import { StartGate } from '../../src/app/StartGate'
import type { DojoDB } from '../../src/data/db'
import type { PlanV2 } from '../../src/data/planV2'
import { loadPlan, runReconcile } from '../../src/data/seed'
import type { PlanJson, Redo, Ticket } from '../../src/data/types'
import { GUIDE } from '../../src/content/guide'
import { resetNow, setNow } from '../../src/lib/clock'
import { clearStudy, saveStudy } from '../../src/lib/studyStore'
import { NARROW_QUERY } from '../../src/lib/useMediaQuery'
import { startStudy } from '../../src/rules/studySession'
import { freshDb } from '../helpers/db'
import { mkTicket } from '../helpers/planV2'
import { renderWithApp } from '../helpers/render'
import { appText, BANNED, CONTROLS, dataContentViolations, GUILT, nameOf, scanDom, type ScanOptions } from '../helpers/scan'

// The editor is CodeMirror; jsdom gets a textarea (as in ticket-view.test.tsx).
vi.mock('../../src/runner/CodeEditor', () => ({
  default: ({ value, onChange }: { value: string; onChange: (s: string) => void }) => <textarea aria-label="Code" value={value} onChange={e => onChange(e.target.value)} />,
}))
const ro = vi.hoisted(() => ({ on: false }))
vi.mock('../../src/data/writer', async importOriginal => ({ ...(await importOriginal<typeof import('../../src/data/writer')>()), isReadOnly: () => ro.on }))

// Task 14: GLOBAL-01, 02, 03, 08, 09 (and the inline-style share of 04, 05) over every surviving screen, rendered against the
// SHIPPED plan (public/data/plan.json through the app's own loader and reconcile), with the clock five days after the plan's
// first day and nothing done since. Layout rules (type floor, corners, scroll) need a browser and are measured in Task 16; the
// stylesheet text is audited by tokens-audit.test.ts.

const DAY = 86_400_000
const START = '2026-11-02'
const WED = new Date(2026, 10, 4, 10).getTime() // the contract's default day, 10:00
const NOW = new Date(2026, 10, 9, 10).getTime() // five days later, no activity since

let v2: PlanV2
let v1: PlanJson
beforeAll(async () => {
  const res = await loadPlan((async () => new Response(readFileSync('public/data/plan.json', 'utf8'))) as unknown as typeof fetch)
  if (!res.ok || !res.v2) throw new Error(res.ok ? 'the shipped plan is not a v2 plan' : res.error)
  v1 = res.plan
  v2 = res.v2
})

afterEach(() => { cleanup(); clearStudy(); resetNow(); ro.on = false; vi.unstubAllGlobals() })

// ------------------------------------------------------------------ fixtures

type Prep = (d: DojoDB, all: Ticket[]) => Promise<void>
interface Boot { route?: string | (() => string); prep?: Prep; settings?: Record<string, unknown>; ready?: string; gate?: boolean; phone?: boolean; readOnly?: boolean }

const ofKind = (all: Ticket[], kind: Ticket['kind']) => all.filter(t => t.kind === kind).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
const firstOf = (all: Ticket[], kind: Ticket['kind'], lane?: string) => ofKind(all, kind).find(t => !lane || t.lane === lane)!
const done = async (d: DojoDB, ids: string[], at = WED) => {
  for (const id of ids) await d.tickets.update(id, { status: 'done', xp: 10, doneAt: at })
}
const redo = (id: string, ticketId: string): Redo => ({ id, ticketId, source: 'check_failed', createdAt: WED, stage: 0, due: WED, passed: [], helpCost: 0, refunded: 0 })
const addRedos = async (d: DojoDB, ids: string[]) => { await d.redos.bulkPut(ids.map((id, i) => redo(`r${i}`, id))) }
const keepRitual = mkTicket({ id: 'ritual.pulse', kind: 'ritual', lane: 'ritual', title: 'AI pulse', estMin: 15 })
const study = (t: Ticket, over: Partial<ReturnType<typeof startStudy>> = {}) =>
  saveStudy({ ...startStudy({ id: 's1', ticketId: t.id, goal: t.title, cardIds: [t.id], focusMin: 25, breakMin: 5, chime: false, now: NOW, single: true }), ...over })

async function boot(o: Boot = {}) {
  setNow(() => NOW)
  clearStudy()
  ro.on = !!o.readOnly
  const d = freshDb()
  await d.settings.put({ id: 'main', startDate: START, planVersion: 't', aiProviders: {}, possibleXp: 0, navLabels: 'always', ...o.settings })
  await runReconcile(d, v2)
  await d.tickets.bulkPut([keepRitual])
  const all = await d.tickets.toArray()
  await o.prep?.(d, all)
  if (o.phone) vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === NARROW_QUERY, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
  const ui = o.gate ? <StartGate><Shell /></StartGate> : <Shell />
  renderWithApp(ui, { db: d, plan: v1, planV2: v2, route: typeof o.route === 'function' ? o.route() : o.route ?? '/' })
  if (o.ready) await screen.findByTestId(o.ready)
  else await screen.findByTestId(o.phone ? 'shell-tabbar' : 'shell-rail')
  await act(async () => { await new Promise(r => setTimeout(r, 120)) })
  return { d, all }
}

// ------------------------------------------------------------------ every screen state

interface State extends Boot { name: string; opt?: ScanOptions; act?: () => Promise<void> | void }

const sixDone: Prep = async (d, all) => { await done(d, ofKind(all, 'problem').slice(0, 6).map(t => t.id)) }
const elevenDue: Prep = async (d, all) => {
  const ids = ofKind(all, 'problem').slice(0, 11).map(t => t.id)
  await done(d, ids)
  await addRedos(d, ids)
}
const allDone: Prep = async (d, all) => { await done(d, all.map(t => t.id)) }
const reviewMix: Prep = async (d, all) => {
  const ids = [firstOf(all, 'problem').id, firstOf(all, 'watch').id, firstOf(all, 'design').id, firstOf(all, 'writeup').id, firstOf(all, 'read').id]
  await done(d, ids)
  await addRedos(d, [ids[1], ids[0], ids[2], ids[3], ids[4]])
}
/** Ticket page states, one of each kind, not started / started / done. */
const startedPrep = (kind: Ticket['kind'], lane?: string): Prep => async (d, all) => {
  const t = firstOf(all, kind, lane)
  await d.tickets.update(t.id, { status: 'doing' })
  study(t)
}
const donePrep = (kind: Ticket['kind'], lane?: string): Prep => async (d, all) => { await done(d, [firstOf(all, kind, lane).id]) }

/** The shipped plan has no link labelled like that, so give a ticket two web links whose labels are plan text with a banned or guilt word. */
const withLinks = (id: () => string, first: string, second: string): Prep => async d => {
  await d.tickets.update(id(), { links: [{ label: first, url: 'https://a.example/one' }, { label: second, url: 'https://b.example/two' }] })
}

const KINDS: Array<[Ticket['kind'], string | undefined]> = [
  ['watch', undefined], ['read', undefined], ['build', undefined], ['task', 'dsa'], ['problem', undefined], ['design', undefined], ['writeup', undefined],
]
// route helpers resolved from the shipped plan, not hard-coded ids
const ids = { watch: '', read: '', build: '', task: '', problem: '', design: '', writeup: '' }
beforeAll(async () => {
  const d = freshDb(); await runReconcile(d, v2)
  const all = await d.tickets.toArray()
  for (const [k, lane] of KINDS) ids[k as keyof typeof ids] = firstOf(all, k, lane).id
})

const firstRow = () => screen.getByTestId('path-upnext').querySelector('[data-testid^="row-"]') as HTMLElement

const SCREENS: State[] = [
  // Today in its states
  { name: 'Today: quest start', prep: sixDone, ready: 'today-quest', opt: { accent: 1 } },
  { name: 'Today: day zero, nothing done (TODAY-22)', ready: 'today-quest', opt: { accent: 1 } },
  { name: 'Today: resume', ready: 'today-quest', prep: async (d, all) => { await sixDone(d, all); await startedPrep('watch')(d, all) }, opt: { accent: 1 } },
  { name: 'Today: review quest (11 due)', prep: elevenDue, ready: 'today-quest', opt: { accent: 1 } },
  { name: 'Today: wait (every ticket done)', prep: allDone, ready: 'today-quest', opt: { accent: 0 } },
  { name: 'Today: empty (no tickets at all)', ready: 'today-quest', prep: async d => { await d.tickets.clear() }, opt: { accent: 0 } },
  { name: 'Today: pick list open', prep: sixDone, ready: 'today-quest', act: () => { fireEvent.click(screen.getByTestId('today-pick-else')) } },
  { name: 'Today: stats drawer open', prep: sixDone, ready: 'today-quest', act: () => { fireEvent.click(screen.getByTestId('today-stats-toggle')) } },
  { name: 'Today: a long ticket waits for a longer day', prep: sixDone, settings: { laneBudgets: [20, 20, 20, 20, 20, 20, 20] }, ready: 'today-quest' },
  { name: 'Today: read-only', prep: sixDone, ready: 'today-quest', readOnly: true },
  // Path
  { name: 'Path', route: '/path', ready: 'path-upnext', opt: { accent: 0 } },
  { name: 'Path: a ticket is started, Done section open', route: '/path', prep: async (d, all) => { await sixDone(d, all); await startedPrep('watch')(d, all) }, ready: 'path-doing', act: () => { fireEvent.click(screen.getByTestId('path-done-toggle')) }, opt: { accent: 1 } },
  { name: 'Path: a row is hovered', route: '/path', ready: 'path-upnext', act: () => { fireEvent.mouseEnter(firstRow()) }, opt: { accent: 0 } },
  { name: 'Path: a row has focus', route: '/path', ready: 'path-upnext', act: () => { fireEvent.focus(firstRow()) }, opt: { accent: 0 } },
  { name: 'Path: a ticket is started and another row is hovered', route: '/path', ready: 'path-doing', opt: { accent: 1 },
    prep: async (d, all) => { await sixDone(d, all); await startedPrep('watch')(d, all) }, act: () => { fireEvent.mouseEnter(firstRow()) } },
  { name: 'Path: search with no match', route: '/path', ready: 'path-search', act: () => { fireEvent.change(screen.getByTestId('path-search'), { target: { value: 'zzzqq' } }) } },
  { name: 'Path: search for the banned word (plan text only)', route: '/path', ready: 'path-search', act: () => { fireEvent.change(screen.getByTestId('path-search'), { target: { value: 'interview' } }) } },
  { name: 'Path: nothing queued', route: '/path', prep: async d => { await d.tickets.clear() }, ready: 'path-empty' },
  // Skills
  { name: 'Skills overview', route: '/skills', ready: 'skills-tabs' },
  { name: 'Skills overview after some work', route: '/skills', prep: async (d, all) => { await done(d, ofKind(all, 'watch').slice(0, 2).map(t => t.id)) }, ready: 'skills-tabs' },
  { name: 'Skills area', route: '/skills/area/llm', ready: 'skills-area-view' },
  { name: 'Skills area on a phone: list and the next panel', route: '/skills/area/llm', phone: true, ready: 'skills-next-start', opt: { accent: 1 } },
  { name: 'Skills area: node selected', route: '/skills/area/llm', ready: 'skills-area-view', act: () => { fireEvent.click(screen.getByTestId('skills-node-L1')) } },
  { name: 'Skills stats', route: '/skills/stats', ready: 'skills-stats' },
  // Review
  { name: 'Review: empty', route: '/review', ready: 'review-empty' },
  { name: 'Review: a card (check or replay)', route: '/review', prep: reviewMix, ready: 'review-card', opt: { accent: 1 } },
  { name: 'Review: a check card answered and revealed', route: '/review', ready: 'review-card',
    prep: async (d, all) => { const t = firstOf(all, 'watch'); await done(d, [t.id]); await addRedos(d, [t.id]) },
    act: () => { fireEvent.change(screen.getByTestId('review-answer'), { target: { value: 'My answer.' } }); fireEvent.click(screen.getByTestId('review-reveal')) }, opt: { accent: 0 } },
  { name: 'Review: a replay card (problem)', route: '/review', ready: 'review-card', opt: { accent: 1 },
    prep: async (d, all) => { const t = firstOf(all, 'problem'); await done(d, [t.id]); await addRedos(d, [t.id]) } },
  { name: 'Review: a replay card (design)', route: '/review', ready: 'review-card', opt: { accent: 1 },
    prep: async (d, all) => { const t = firstOf(all, 'design'); await done(d, [t.id]); await addRedos(d, [t.id]) } },
  { name: 'Review: a check card (watch)', route: '/review', ready: 'review-card', opt: { accent: 1 },
    prep: async (d, all) => { const t = firstOf(all, 'watch'); await done(d, [t.id]); await addRedos(d, [t.id]) } },
  { name: 'Review: eleven cards', route: '/review', prep: elevenDue, ready: 'review-card' },
  // ticket view: every kind, not started, started, done
  ...KINDS.flatMap(([kind, lane]) => {
    const route = () => `/do/${ids[kind as keyof typeof ids]}`
    return [
      { name: `Ticket ${kind}: not started`, route, ready: 'do-title', opt: { accent: kind === 'problem' ? undefined : 1 } },
      { name: `Ticket ${kind}: started`, route, ready: 'do-title', prep: startedPrep(kind, lane), opt: { accent: kind === 'problem' ? undefined : 1 } },
      { name: `Ticket ${kind}: done`, route, ready: 'do-title', prep: donePrep(kind, lane), opt: { accent: 0 } },
    ] as State[]
  }),
  { name: 'Ticket ritual: not started', route: '/do/ritual.pulse', ready: 'do-title', opt: { accent: 1 } },
  { name: 'Ticket ritual: started', route: '/do/ritual.pulse', ready: 'do-title', prep: async d => { await d.tickets.update('ritual.pulse', { status: 'doing' }); study(keepRitual) }, opt: { accent: 1 } },
  { name: 'Ticket ritual: done', route: '/do/ritual.pulse', ready: 'do-title', prep: async d => { await done(d, ['ritual.pulse']) }, opt: { accent: 0 } },
  { name: 'Ticket: a task whose link label says Interview', route: () => `/do/${ids.task}`, ready: 'do-title', prep: withLinks(() => ids.task, 'Hello Interview: system design', 'interviewing.io: mock interview') },
  { name: 'Ticket: a watch whose link label says behind', route: () => `/do/${ids.watch}`, ready: 'do-title', prep: withLinks(() => ids.watch, 'Why the plan fell behind the schedule', 'Days since the plan fell behind') },
  { name: 'Ticket: the session is over (time up)', route: () => `/do/${ids.watch}`, ready: 'do-title', prep: async (d, all) => { const t = all.find(x => x.id === ids.watch)!; await d.tickets.update(t.id, { status: 'doing' }); study(t, { over: true }) } },
  { name: 'Ticket: missing', route: '/do/nope', ready: 'screen-do' },
  // Settings, Guide, onboarding
  { name: 'Settings', route: '/settings', ready: 'settings-pace' },
  { name: 'Settings: an archived ticket whose title says interview', route: '/settings', ready: 'settings-pace',
    prep: async (d, all) => {
      const t = all.find(x => /interview/i.test(x.title))
      if (!t) throw new Error('the shipped plan has no ticket titled with "interview", so this state cannot be built')
      await d.tickets.update(t.id, { archived: true })
    } },
  { name: 'Settings: read-only', route: '/settings', ready: 'settings-pace', readOnly: true },
  { name: 'Guide', route: '/guide', ready: 'guide-section-' + GUIDE[0].id },
  { name: 'Onboarding', gate: true, settings: { startDate: '' }, ready: 'screen-onboarding', opt: { accent: 1 } },
  // shell chrome
  { name: 'Shell: palette open', ready: 'today-quest', prep: sixDone, act: () => { fireEvent.click(screen.getByTestId('shell-search')) }, opt: { accent: 1 } },
  { name: 'Shell: palette, keyboard selection on the second result', ready: 'today-quest', act: async () => {
    fireEvent.click(screen.getByTestId('shell-search'))
    fireEvent.keyDown(await screen.findByTestId('shell-palette'), { key: 'ArrowDown' })
  } },
  { name: 'Shell: palette with plan-text results', ready: 'today-quest', act: async () => {
    fireEvent.click(screen.getByTestId('shell-search'))
    fireEvent.change(await screen.findByTestId('shell-palette-input'), { target: { value: 'interview' } })
  } },
  { name: 'Shell: palette, nothing matches', ready: 'today-quest', act: async () => {
    fireEvent.click(screen.getByTestId('shell-search'))
    fireEvent.change(await screen.findByTestId('shell-palette-input'), { target: { value: 'zzzqq' } })
  } },
  { name: 'Shell: shortcuts open', ready: 'today-quest', act: () => { fireEvent.click(screen.getByTestId('shell-gear')); fireEvent.click(screen.getByTestId('shell-menu-shortcuts')) } },
  { name: 'Shell: gear menu open', ready: 'today-quest', act: () => { fireEvent.click(screen.getByTestId('shell-gear')) } },
  { name: 'Shell: plan-changed notice', ready: 'today-quest', prep: async d => { await d.events.add({ t: 'replan', at: 5, report: {} } as never) } },
  { name: 'Shell: phone tab bar on Today', phone: true, ready: 'today-quest', prep: sixDone },
  // the four screens that left the nav
  { name: 'Banks', route: '/banks', ready: 'banks-visible-count', opt: { legacy: true } },
  { name: 'Banks: the learner bank', route: '/banks?bank=mine', ready: 'banks-visible-count', opt: { legacy: true } },
  { name: 'Banks: the second pack', route: '/banks?bank=neetcode150', ready: 'banks-visible-count', opt: { legacy: true } },
  { name: 'DSA', route: '/dsa', ready: 'dsa-hint', opt: { legacy: true } },
  { name: 'Designs', route: '/designs', ready: 'designs-hint', opt: { legacy: true } },
  { name: 'Atlas', route: '/atlas', ready: 'atlas-summary', opt: { legacy: true } },
]

describe('R1 global scans over every surviving screen (GLOBAL-01, 02, 03, 08, 09)', () => {
  it.each(SCREENS.map(s => [s.name, s] as const))('%s', async (_n, s) => {
    await boot(s)
    if (s.act) { await s.act(); await act(async () => { await new Promise(r => setTimeout(r, 60)) }) }
    expect(document.querySelector('[data-testid="screen-error"]'), 'the error fallback is showing').toBeNull()
    CHECKS[s.name]?.() // the fixture really reached the state its name promises, so a clean scan is not a scan of the wrong screen
    expect(scanDom(document.body, s.opt)).toEqual([])
  })
})

const action = (a: string) => () => expect(screen.getByTestId('today-quest')).toHaveAttribute('data-action', a)
const has = (...tids: string[]) => () => { for (const t of tids) expect(screen.queryAllByTestId(t).length, t).toBeGreaterThan(0) }
const lacks = (...tids: string[]) => () => { for (const t of tids) expect(screen.queryAllByTestId(t).length, `${t} must be absent`).toBe(0) }
const all = (...fs: Array<() => void>) => () => { for (const f of fs) f() }
const timer = (word: string) => () => expect(screen.getByTestId('timer-state'), 'timer-state').toHaveTextContent(new RegExp(`^${word}$`))
const hovered = () => {
  const starts = [...document.querySelectorAll<HTMLElement>('[data-testid^="path-row-start-"]')]
  expect(starts.length, 'the quiet Start of the hovered or focused row').toBe(1)
  expect(starts[0].getAttribute('data-accent')).toBeNull()
  expect(starts[0].className).not.toMatch(/accent/)
}
const accentIs = (id: string, on: boolean) => () => {
  const el = screen.getByTestId(id)
  expect(el.getAttribute('data-accent') === 'primary', `${id} data-accent`).toBe(on)
}
/** What each ticket state must show, so a green scan is a scan of the page the name claims. */
function ticketChecks(kind: Ticket['kind']): Record<'new' | 'started' | 'done', () => void> {
  if (kind === 'design' || kind === 'writeup') {
    // no timer on a design page and no marker of a started session: the page differs only in the one link
    return {
      new: all(has('ticket-open-session'), accentIs('ticket-open-session', true), lacks('ticket-done-state')),
      started: all(has('ticket-open-session'), accentIs('ticket-open-session', true), lacks('ticket-done-state', 'ticket-start')),
      done: all(has('ticket-open-session'), accentIs('ticket-open-session', false), () => expect(screen.getByTestId('ticket-open-session').className).not.toMatch(/accent/)),
    }
  }
  if (kind === 'problem') {
    return {
      new: all(has('ticket-start'), lacks('ticket-done-state', 'session-panel'), timer('ready')),
      started: all(has('session-panel'), lacks('ticket-start', 'ticket-done-state')),
      done: all(has('ticket-done-state'), lacks('ticket-start', 'session-panel')),
    }
  }
  return {
    new: all(has('ticket-start'), accentIs('ticket-start', true), lacks('ticket-done-state'), kind === 'ritual' ? has('ticket-done') : lacks('ticket-done'), timer('ready')),
    started: all(has('ticket-done'), accentIs('ticket-done', true), lacks('ticket-start', 'ticket-done-state'), timer('running')),
    done: all(has('ticket-done-state'), lacks('ticket-start', 'ticket-done'), timer('finished')),
  }
}
const inPlanText = (re: RegExp) => () => {
  const hits = [...document.querySelectorAll('[data-content]')].filter(e => re.test(e.textContent ?? ''))
  expect(hits.length, `plan text matching ${re}`).toBeGreaterThan(0)
}
const CHECKS: Record<string, () => void> = {
  'Today: quest start': action('start'),
  'Today: day zero, nothing done (TODAY-22)': action('start'),
  'Today: resume': action('resume'),
  'Today: review quest (11 due)': action('review'),
  'Today: wait (every ticket done)': all(action('wait'), lacks('start-button')),
  'Today: empty (no tickets at all)': action('wait'),
  'Today: a long ticket waits for a longer day': has('today-waits'),
  'Today: read-only': all(action('start'), () => expect(screen.getByTestId('start-button')).toBeDisabled()),
  'Today: pick list open': has('today-pick-list'),
  'Today: stats drawer open': has('today-stats'),
  'Path': all(has('path-upnext', 'path-doing'), lacks('path-no-match'), () => expect(screen.getByTestId('path-doing-title')).toHaveTextContent('Doing 0'), () => expect(document.querySelector('[data-testid^="path-row-start-"]')).toBeNull()),
  'Path: a ticket is started, Done section open': all(has('path-doing', 'path-done'), () => {
    expect(within(screen.getByTestId('path-doing')).queryAllByRole('button').filter(b => b.getAttribute('data-accent') === 'primary')).toHaveLength(1) // PATH-17: the one accent sits in the Doing row
    expect(screen.getByTestId('path-done').querySelectorAll('[data-testid^="row-"]').length, 'the Done section is open and lists rows').toBeGreaterThan(0)
  }),
  'Path: search with no match': has('path-no-match'),
  'Path: search for the banned word (plan text only)': () => {
    const rows = document.querySelectorAll('[data-testid^="row-"]')
    expect(rows.length, 'rows that match "interview"').toBeGreaterThan(0)
    expect(screen.queryByTestId('path-no-match')).toBeNull()
    expect([...rows].some(r => /interview/i.test(r.textContent ?? '')), 'a matching row shows the plan title').toBe(true)
  },
  'Path: a row is hovered': hovered,
  'Path: a row has focus': hovered,
  'Path: a ticket is started and another row is hovered': all(has('path-doing'), hovered),
  'Path: nothing queued': has('path-empty'),
  'Skills area on a phone: list and the next panel': all(has('skills-list', 'skills-next-panel', 'skills-next-start'), lacks('skills-node-L1')),
  'Skills area: node selected': () => { has('skills-node-panel', 'skills-node-start')(); expect(document.querySelector('[data-state="next"]')).not.toBeNull() },
  'Review: a card (check or replay)': has('review-card'),
  'Review: eleven cards': () => { expect(screen.getByTestId('review-count')).toHaveAttribute('data-count', '11'); expect(screen.getByTestId('review-position')).toHaveTextContent('of 11') },
  'Review: a replay card (problem)': () => expect(screen.getByTestId('review-card')).toHaveAttribute('data-kind', 'replay'),
  'Review: a replay card (design)': () => expect(screen.getByTestId('review-card')).toHaveAttribute('data-kind', 'replay'),
  'Review: a check card (watch)': () => expect(screen.getByTestId('review-card')).toHaveAttribute('data-kind', 'check'),
  'Review: a check card answered and revealed': has('review-your-answer', 'review-grade-got'),
  'Ticket: a task whose link label says Interview': all(has('do-title'), inPlanText(/interviewing\.io: mock interview/)),
  'Ticket: a watch whose link label says behind': all(has('do-title'), inPlanText(/Days since the plan fell behind/)),
  'Ticket: the session is over (time up)': has('ticket-time-up'),
  'Settings': lacks('archived-list'),
  'Settings: an archived ticket whose title says interview': () => { has('archived-list')(); expect(within(screen.getByTestId('archived-list')).getByText(/interview/i)).toHaveAttribute('data-content', 'plan') },
  'Settings: read-only': () => expect(document.querySelector('[data-testid="screen-settings"] button:disabled'), 'a disabled control proves read-only').not.toBeNull(),
  'Ticket: missing': () => expect(screen.getByTestId('screen-do').textContent ?? '').not.toBe(''),
  'Shell: palette open': has('shell-palette', 'shell-palette-item'),
  'Shell: palette, keyboard selection on the second result': () => {
    const items = screen.getAllByTestId('shell-palette-item')
    expect(items[0]).toHaveAttribute('aria-selected', 'false')
    expect(items[1]).toHaveAttribute('aria-selected', 'true')
  },
  'Shell: palette with plan-text results': has('shell-palette-item'),
  'Shell: palette, nothing matches': has('shell-palette-empty'),
  'Shell: shortcuts open': has('shell-shortcuts'),
  'Shell: gear menu open': has('shell-gear-menu'),
  'Shell: plan-changed notice': has('shell-plan-changed'),
  'Shell: phone tab bar on Today': has('shell-tabbar'),
}

for (const [kind] of KINDS) {
  const c = ticketChecks(kind)
  CHECKS[`Ticket ${kind}: not started`] = c.new
  CHECKS[`Ticket ${kind}: started`] = c.started
  CHECKS[`Ticket ${kind}: done`] = c.done
}
{
  const c = ticketChecks('ritual')
  CHECKS['Ticket ritual: not started'] = c.new
  CHECKS['Ticket ritual: started'] = c.started
  CHECKS['Ticket ritual: done'] = c.done
}

// ------------------------------------------------------------------ contract extras

describe('GLOBAL-02 with the clock five days on and no activity', () => {
  it('Today, Path, Review and Settings say nothing about days since or missed work', async () => {
    for (const route of ['/', '/path', '/review', '/settings', '/skills']) {
      cleanup()
      await boot({ route })
      const text = appText(document.body)
      expect(text.match(GUILT), route).toBeNull()
      expect(text.match(BANNED), route).toBeNull()
    }
  })
  it('Today on a day-zero fixture has no streak, no debt and no number followed by "due" (TODAY-22), nor any sprint wording (TODAY-32)', async () => {
    await boot({ ready: 'today-quest' })
    const t = screen.getByTestId('screen-today').textContent ?? ''
    expect(t).not.toMatch(/streak|debt|\d+\s*due/i)
    expect(t).not.toMatch(/sprint|slid|rolled|rebalance|load check|carrot/i)
  })
  it('the pace section of Settings never says behind, late or overdue (SET-04)', async () => {
    await boot({ route: '/settings', ready: 'settings-pace' })
    expect(screen.getByTestId('settings-pace').textContent ?? '').not.toMatch(/behind|late|overdue/i)
  })
  it('a ticket page has no "Plan this session", "Load check" or "Dig in" (TICKET-36); Review has no Redo drawer, Redesigns or Ritual heading (REVIEW-22)', async () => {
    await boot({ route: `/do/${ids.watch}`, ready: 'do-title' })
    expect(screen.getByTestId('screen-do').textContent ?? '').not.toMatch(/Plan this session|Load check|Dig in/i)
    cleanup()
    await boot({ route: '/review', prep: reviewMix, ready: 'review-card' })
    const heads = [...screen.getByTestId('screen-review').querySelectorAll('h1, h2, h3')].map(h => h.textContent ?? '').join(' | ')
    expect(heads).not.toMatch(/Redo drawer|Redesigns|Ritual/i)
  })
  it('keeps the guide copy clean at the source', () => {
    const all = GUIDE.flatMap(s => [s.title, ...s.paragraphs, ...(s.prompts ?? [])]).join(' ')
    expect(all.match(BANNED)).toBeNull()
    expect(all.match(GUILT)).toBeNull()
  })
  it('the stored plan text itself is shown only inside data-content (the shipped plan has words the scan would trip on)', async () => {
    const raw = JSON.stringify(v2)
    expect(raw.match(BANNED) ?? raw.match(GUILT), 'if this fails the plan no longer has such words and the plan-text exemption is untested').not.toBeNull()
    await boot({ route: '/path', ready: 'path-upnext' })
    fireEvent.change(screen.getByTestId('path-search'), { target: { value: 'interview' } })
    await act(async () => { await new Promise(r => setTimeout(r, 60)) })
    expect(document.body.textContent).toMatch(/interview/i) // plan titles are rendered ...
    expect(appText(document.body).match(BANNED)).toBeNull() // ... and every one of them is inside data-content
  })
})

describe('GLOBAL-03 accent', () => {
  it('Review has exactly one accent before the reveal and none after (REVIEW-20)', async () => {
    await boot({ route: '/review', prep: async (d, all) => { const t = firstOf(all, 'watch'); await done(d, [t.id]); await addRedos(d, [t.id]) }, ready: 'review-card' })
    expect(document.querySelectorAll('[data-accent="primary"]')).toHaveLength(1)
    expect(screen.getByTestId('review-reveal')).toHaveAttribute('data-accent', 'primary')
    fireEvent.change(screen.getByTestId('review-answer'), { target: { value: 'x' } })
    fireEvent.click(screen.getByTestId('review-reveal'))
    expect(document.querySelectorAll('[data-accent="primary"]')).toHaveLength(0)
  })

  it('names the contract strings: START · REVIEW, START · PLAN, DONE · WATCH, OPEN · DESIGN, REDO · PROBLEM, START · <KIND>, RESUME · <time>', async () => {
    await boot({ prep: elevenDue, ready: 'start-button' })
    expect(screen.getByTestId('start-button')).toHaveTextContent('START · REVIEW')
    cleanup()
    await boot({ gate: true, settings: { startDate: '' }, ready: 'onboarding-submit' })
    expect(screen.getByTestId('onboarding-submit')).toHaveTextContent('START · PLAN')
    cleanup()
    await boot({ route: `/do/${ids.watch}`, ready: 'ticket-start' })
    expect(screen.getByTestId('ticket-start')).toHaveTextContent('START · WATCH')
    cleanup()
    await boot({ route: `/do/${ids.watch}`, ready: 'ticket-done', prep: startedPrep('watch') }).catch(() => undefined)
    cleanup()
    await boot({ route: `/do/${ids.design}`, ready: 'ticket-open-session' })
    expect(screen.getByTestId('ticket-open-session')).toHaveTextContent('OPEN · DESIGN')
    cleanup()
    await boot({ route: '/review', prep: async (d, all) => { const t = firstOf(all, 'problem'); await done(d, [t.id]); await addRedos(d, [t.id]) }, ready: 'review-redo' })
    expect(screen.getByTestId('review-redo')).toHaveTextContent('REDO · PROBLEM')
    cleanup()
    await boot({ prep: async (d, all) => { await sixDone(d, all); await startedPrep('watch')(d, all) }, ready: 'start-button' })
    expect(screen.getByTestId('start-button').textContent).toMatch(/^RESUME · (\d{1,2}:\d{2}|\w+)/)
    for (const [kind, lane] of KINDS.filter(([k]) => k !== 'design' && k !== 'writeup')) {
      cleanup()
      await boot({ route: `/do/${ids[kind as keyof typeof ids]}`, ready: 'ticket-start' })
      expect(screen.getByTestId('ticket-start').textContent, `${kind} ${lane ?? ''}`).toMatch(new RegExp(`^START · ${kind.toUpperCase()}$`))
    }
  })

  it('a started ticket has DONE · <KIND> as the accent, last in its action group', async () => {
    await boot({ route: `/do/${ids.watch}`, prep: startedPrep('watch'), ready: 'ticket-done' })
    const done = screen.getByTestId('ticket-done')
    expect(done).toHaveTextContent('DONE · WATCH')
    expect(done).toHaveAttribute('data-accent', 'primary')
    expect(scanDom(document.body, { accent: 1 })).toEqual([])
  })

  it('a problem has at most one orange button in any state (TICKET-32), the accent or none', async () => {
    for (const prep of [undefined, startedPrep('problem'), donePrep('problem')]) {
      cleanup()
      await boot({ route: `/do/${ids.problem}`, prep, ready: 'do-title' })
      const painted = scanDom(document.body).filter(v => v.startsWith('GLOBAL-03'))
      expect(painted).toEqual([])
    }
  })

  it('the Skills area view has exactly one accent when a next node is selected, and no orange button besides it', async () => {
    await boot({ route: '/skills/area/llm', ready: 'skills-area-view' })
    fireEvent.click(screen.getByTestId('skills-node-L1'))
    await act(async () => { await new Promise(r => setTimeout(r, 40)) })
    const panel = screen.queryByTestId('skills-node-panel')
    expect(panel).not.toBeNull()
    // ruling R9: nodes are SVG groups with role="button", exempt from the button-colour scan
    for (const n of document.querySelectorAll('[data-testid^="skills-node-"][role="button"]')) expect(n.closest('svg'), n.getAttribute('data-testid') ?? '').not.toBeNull()
    expect(scanDom(document.body)).toEqual([])
  })

  it('the palette, the shortcuts and the gear menu carry no accent', async () => {
    await boot({ prep: sixDone })
    fireEvent.click(screen.getByTestId('shell-gear'))
    expect(screen.getByTestId('shell-gear-menu').querySelectorAll('[data-accent]')).toHaveLength(0)
    fireEvent.click(screen.getByTestId('shell-menu-shortcuts'))
    const sc = await screen.findByTestId('shell-shortcuts')
    expect(sc.querySelectorAll('[data-accent]')).toHaveLength(0)
    fireEvent.keyDown(sc, { key: 'Escape' })
    fireEvent.click(screen.getByTestId('shell-search'))
    expect((await screen.findByTestId('shell-palette')).querySelectorAll('[data-accent]')).toHaveLength(0)
  })
})

describe('GLOBAL-08 names', () => {
  it('every control of every destination has a name when the rail shows icons only', async () => {
    for (const route of ['/', '/path', '/skills', '/review', '/settings', '/guide']) {
      cleanup()
      await boot({ route, settings: { navLabels: 'hover' } })
      const unnamed = [...document.querySelectorAll(CONTROLS)].filter(e => nameOf(e) === '').map(e => e.outerHTML.slice(0, 80))
      expect(unnamed, route).toEqual([])
      for (const id of ['shell-nav-today', 'shell-nav-path', 'shell-nav-skills', 'shell-nav-review']) expect(nameOf(screen.getByTestId(id)), id).not.toBe('')
    }
  })
})

describe('GLOBAL-09 empty states', () => {
  const sentence = (el: HTMLElement) => { const c = el.cloneNode(true) as HTMLElement; c.querySelectorAll('a, button').forEach(x => x.remove()); return (c.textContent ?? '').trim() }

  it('Review with nothing due: "Nothing is due." and Go to Today', async () => {
    await boot({ route: '/review', ready: 'review-empty' })
    const e = screen.getByTestId('review-empty')
    expect(e).toHaveAttribute('data-empty', 'true')
    expect(sentence(e)).toBe('Nothing is due.')
    expect(within(e).getByTestId('review-empty-action')).toHaveTextContent('Go to Today')
    expect(e.querySelectorAll('a, button')).toHaveLength(1)
    expect(e.querySelector('svg, img, h1, h2, h3')).toBeNull()
  })
  it('Path search with no match: one sentence and Clear search', async () => {
    await boot({ route: '/path', ready: 'path-search' })
    fireEvent.change(screen.getByTestId('path-search'), { target: { value: 'zzzqq' } })
    const e = await screen.findByTestId('path-no-match')
    expect(e).toHaveAttribute('data-empty', 'true')
    expect(sentence(e).split(/[.!?]\s/).length).toBe(1)
    expect(within(e).getByTestId('path-search-clear')).toHaveTextContent('Clear search')
    expect(e.querySelectorAll('a, button')).toHaveLength(1)
    expect(e.querySelector('svg, img, h1, h2, h3')).toBeNull()
  })
  it('a populated Path with nothing running keeps its quiet Doing line without claiming data-empty (it is not the screen empty state)', async () => {
    await boot({ route: '/path', ready: 'path-search' })
    const line = screen.getByTestId('path-doing-idle')
    expect(line).not.toHaveAttribute('data-empty')
    expect(document.querySelectorAll('[data-empty]')).toHaveLength(0)
    expect(scanDom(document.body, { accent: 0 }).filter(v => v.startsWith('GLOBAL-09'))).toEqual([])
  })
  it('the palette with nothing: "Nothing matches." and no action (SHELL-18)', async () => {
    await boot()
    fireEvent.click(screen.getByTestId('shell-search'))
    fireEvent.change(await screen.findByTestId('shell-palette-input'), { target: { value: 'zzzqq' } })
    const e = await screen.findByTestId('shell-palette-empty')
    expect(e).toHaveAttribute('data-empty', 'true')
    expect(e.textContent?.trim()).toBe('Nothing matches.')
    expect(e.querySelectorAll('a, button')).toHaveLength(0)
  })
})

describe('count and value hooks', () => {
  it('review-count, shell-review-badge and today-review-chip carry the same integer as their text (REVIEW-02)', async () => {
    const six: Prep = async (d, all) => {
      const ids = ofKind(all, 'problem').slice(0, 6).map(t => t.id)
      await done(d, ids)
      await addRedos(d, ids)
    }
    await boot({ prep: six, ready: 'today-review-chip' })
    for (const id of ['shell-review-badge', 'today-review-chip']) {
      const el = screen.getByTestId(id)
      expect(el, id).toHaveAttribute('data-count', '6')
      expect(el.textContent, id).toMatch(/\b6\b/)
    }
    cleanup()
    await boot({ route: '/review', prep: six, ready: 'review-count' })
    expect(screen.getByTestId('review-count')).toHaveAttribute('data-count', '6')
    expect(screen.getByTestId('review-count').textContent).toBe('6')
  })

  it('xp-total sums xp over tickets without mergedInto, and level is floor(xp / 10) (SHELL-25)', async () => {
    const prep: Prep = async (d, all) => {
      await done(d, ofKind(all, 'problem').slice(0, 7).map(t => t.id)) // 70 xp
      await d.tickets.update(ofKind(all, 'problem')[7].id, { status: 'done', xp: 50, mergedInto: ofKind(all, 'problem')[0].id }) // the trap
    }
    const { d } = await boot({ prep, ready: 'xp-total' })
    const sum = (await d.tickets.toArray()).filter(t => !t.mergedInto).reduce((n, t) => n + (t.xp ?? 0), 0)
    expect(sum).toBe(70)
    expect(screen.getByTestId('xp-total')).toHaveAttribute('data-value', String(sum))
    expect(within(screen.getByTestId('shell-header')).getByTestId('level')).toHaveAttribute('data-value', String(Math.floor(sum / 10))) // Today's Pom card holds a second `level` (TODAY-50)
  })
})

describe('GLOBAL-04 and 05 as far as markup can show them', () => {
  it('no rendered inline style sets a font-size under 14px, a radius, or Silkscreen on a button', async () => {
    for (const route of ['/', '/path', '/skills', '/review', `/do/${ids.watch}`, '/settings', '/guide']) {
      cleanup()
      await boot({ route })
      const bad = [...document.querySelectorAll<HTMLElement>('[style]')].filter(e => /font-size:\s*(\d|1[0-3])(\.\d+)?px|border-radius:\s*[1-9]/.test(e.getAttribute('style') ?? ''))
      expect(bad.map(e => e.outerHTML.slice(0, 100)), route).toEqual([])
    }
  })
})

// ------------------------------------------------------------------ the scanner must catch what it claims to catch

describe('the scanner itself', () => {
  const scan = (html: string, opt: ScanOptions = {}) => {
    const host = document.createElement('div')
    host.innerHTML = html
    document.body.appendChild(host)
    try { return scanDom(host, opt) } finally { host.remove() }
  }

  it('flags a banned word and guilt wording in text and in aria-label, and skips plan and learner text', () => {
    expect(scan('<p>Dig in now</p>').join()).toMatch(/GLOBAL-01/)
    expect(scan('<button aria-label="Retreat">x</button>').join()).toMatch(/GLOBAL-01/)
    expect(scan('<p>Interviews</p>').join()).toMatch(/GLOBAL-01/)
    expect(scan('<p>You are 3 days behind</p>').join()).toMatch(/GLOBAL-02/)
    expect(scan('<p>Nothing for 5 days without a session</p>').join()).toMatch(/GLOBAL-02/)
    expect(scan('<p data-content="plan">A system design interview, behind the scenes</p><p data-content="learner">overdue</p>')).toEqual([])
  })
  it('flags two accents, a wrong label, an unnamed control, and an orange button that is not the accent', () => {
    expect(scan('<button class="sr-btn sr-btn-accent" data-accent="primary">A · B</button><button class="sr-btn sr-btn-accent" data-accent="primary">C · D</button>').join()).toMatch(/2 data-accent/)
    expect(scan('<button class="sr-btn sr-btn-accent" data-accent="primary">Start</button>').join()).toMatch(/VERB · OBJECT/)
    expect(scan('<button class="sr-btn sr-btn-accent">Go · Now</button>').join()).toMatch(/orange button without data-accent/)
    expect(scan('<button></button><a href="/x"></a><input type="text"><input type="text" placeholder="Search">').filter(v => v.startsWith('GLOBAL-08'))).toHaveLength(4)
    expect(scan('<button aria-label="Close"></button><label>Name <input type="text"></label>')).toEqual([])
  })
  it('flags a focusable control after the accent inside its action group, and exempts an SVG node (R9)', () => {
    expect(scan('<div class="qc-actions"><button class="sr-btn sr-btn-accent" data-accent="primary">A · B</button><button>Later</button></div>').join()).toMatch(/tab order/)
    expect(scan('<div class="qc-actions"><button>First</button><button class="sr-btn sr-btn-accent" data-accent="primary">A · B</button></div>')).toEqual([])
    expect(scan('<div class="qc-actions"><button class="sr-btn sr-btn-accent" data-accent="primary">A · B</button></div><svg><g role="button" tabindex="0" aria-label="n" class="sr-btn-accent"></g></svg>')).toEqual([])
  })
  it('flags an empty state without data-empty, with two actions, with more than a sentence, and with a glyph', () => {
    expect(scan('<div data-testid="x-empty"><p>Nothing.</p></div>').join()).toMatch(/lacks data-empty/)
    expect(scan('<div data-testid="x-empty" data-empty="true"><p>Nothing.</p><a href="/a">A</a><a href="/b">B</a></div>').join()).toMatch(/more than one action/)
    expect(scan('<div data-testid="x-empty" data-empty="true"><p>Nothing here. Try again.</p></div>').join()).toMatch(/more than one sentence/)
    expect(scan('<div data-testid="x-empty" data-empty="true"><svg></svg><p>Nothing.</p></div>').join()).toMatch(/more than a sentence/)
    expect(scan('<div data-testid="x-empty" data-empty="true"><p>Nothing.</p><a href="/a">Go</a></div>')).toEqual([])
  })
  it('reads hue and saturation: the default control fill is not flagged, a saturated blue is (TODAY-31)', async () => {
    const { colorOf, hsl } = await import('../helpers/scan')
    const fill = hsl(colorOf('#3a4162')!)
    expect(fill.h).toBeGreaterThan(200); expect(fill.h).toBeLessThan(260); expect(fill.s).toBeLessThan(0.5)
    const blue = hsl(colorOf('#3ab4ff')!)
    expect(blue.h).toBeGreaterThanOrEqual(200); expect(blue.s).toBeGreaterThan(0.5)
  })
  // mutation-like synthetic DOMs: each is a real page defect the first version of the scan let through
  it('mutation: an inline-style orange button and a bare accent-class link without data-accent both turn the scan red', () => {
    expect(scan('<button style="background: #ff8a2a">Go · Now</button>').join()).toMatch(/orange button without data-accent/)
    expect(scan('<button style="background-color:rgb(255,138,42)">Go · Now</button>').join()).toMatch(/orange button without data-accent/)
    expect(scan('<a href="/x" class="sr-btn-accent">Go · Now</a>').join()).toMatch(/orange button without data-accent/)
    expect(scan('<a href="/x" class="sr-btn sr-btn-accent">Go · Now</a>').join()).toMatch(/orange button without data-accent/)
    expect(scan('<div role="button" tabindex="0" style="background:#ff8a2a">Go · Now</div>').join()).toMatch(/orange button without data-accent/)
    expect(scan('<button style="background:#1e90ff">Go</button>').join()).toMatch(/TODAY-31/)
    expect(scan('<button style="background:#3a4162">Go</button>')).toEqual([])
  })
  it('mutation: a banned word or guilt wording in a data-tip or aria-description is found, and adjacent runs are read as separated words', () => {
    expect(scan('<span data-tip="Dig in now">i</span>').join()).toMatch(/GLOBAL-01/)
    expect(scan('<span aria-description="3 days behind">i</span>').join()).toMatch(/GLOBAL-02/)
    expect(scan('<p>Dig<span>in</span></p>').join()).toMatch(/GLOBAL-01/)
    const root = document.createElement('div')
    root.setAttribute('aria-label', 'Retreat')
    expect(appText(root)).toMatch(/Retreat/) // the root's own attributes count
  })
  it('mutation: app copy inside a data-content element turns the scan red, plan text in an aria-label does not', () => {
    expect(scan('<button data-content="plan">Start</button>').join()).toMatch(/exemption/)
    expect(scan('<div role="button" tabindex="0" data-content="plan" aria-label="Plan title, Open"><span>x</span></div>').join()).toMatch(/exemption/)
    expect(scan('<li role="treeitem" data-content="plan"><span>Plan title</span></li>').join()).toMatch(/exemption/)
    expect(scan('<a href="/x" data-content="plan"><b>Open the video</b><button>Go</button></a>').join()).toMatch(/exemption/)
    expect(scan('<p data-content="plan"><span aria-label="Retreat">x</span></p>').join()).toMatch(/exemption/)
    expect(scan('<span data-content="plan">Needs</span>').join()).toMatch(/exemption/)
    expect(scan('<a href="/x" data-content="plan"><b>Open the video</b><span>youtu.be</span></a>').join()).toMatch(/exemption/)
    expect(scan('<span data-content="plan">Needs <b>Math</b></span>').join()).toMatch(/exemption/)
    expect(scan('<span data-content="learner">  Review </span>').join()).toMatch(/exemption/)
    // plan text inside a label is plan text; the app word beside it is still read
    expect(scan('<button aria-label="Hello Interview, In progress"><span data-content="plan">Hello Interview</span></button>')).toEqual([])
    expect(scan('<button aria-label="Hello Interview, Dig in"><span data-content="plan">Hello Interview</span></button>').join()).toMatch(/GLOBAL-01/)
    // a plan link and a learner field may carry their own label
    expect(scan('<a href="/x" data-content="plan" aria-label="Open · host, Plan label">Plan label</a><textarea data-content="learner" aria-label="Answer"></textarea>')).toEqual([])
    expect(dataContentViolations(document.body)).toEqual([])
  })
})
