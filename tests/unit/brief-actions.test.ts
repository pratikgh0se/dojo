import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { approveBrief, draftBrief, draftSprint, saveBrief, saveLinkCheck, cleanEdit } from '../../src/data/briefActions'
import { FAKE_FAIL_KEY } from '../../src/ai/fake'
import { splitIntoSessions } from '../../src/data/splitActions'
import { minutesOf } from '../../src/rules/brief'
import { seededDb } from '../helpers/db'
import { mkTicket } from '../helpers/tickets'

const NOW = 1_800_000_000_000
const failHook = (v: string | null) => { if (v === null) localStorage.removeItem(FAKE_FAIL_KEY); else localStorage.setItem(FAKE_FAIL_KEY, v) }
beforeEach(() => failHook(null))
afterEach(() => failHook(null))

describe('draftBrief', () => {
  it('stores a draft brief on the ticket and logs one aiLog row', async () => {
    const d = await seededDb()
    const t = mkTicket({ id: 'w1', kind: 'watch', track: 'interview', title: 'Watch hashing' })
    await d.tickets.put(t)
    expect(await draftBrief(d, t.id, NOW)).toEqual({ ok: true, drafted: true })
    const b = (await d.tickets.get(t.id))!.brief!
    expect(b).toMatchObject({ status: 'draft', source: 'ai', minutes: 60, dayType: 'focus', goal: `Understand ${t.title}` })
    expect(b.deliverable.kind).toBe('answers')
    expect(await d.aiLog.where('job').equals('brief').count()).toBe(1)
  })
  it('a forge (stage) card gets a typed-by-hand code deliverable and no fenced code', async () => {
    const d = await seededDb()
    const t = mkTicket({ id: 'stage-x', kind: 'stage', track: 'ai', title: 'Stage X, build 1 of 3' })
    await d.tickets.put(t)
    await draftBrief(d, t.id, NOW)
    const b = (await d.tickets.get(t.id))!.brief!
    expect(b.deliverable).toEqual({ kind: 'code', prompt: 'Paste your code, typed by hand' })
    expect(b.steps.some(s => s.text.includes('```'))).toBe(false)
  })
  it('skips a card that already has a brief', async () => {
    const d = await seededDb()
    const id = (await d.tickets.toArray())[0].id
    await draftBrief(d, id, NOW)
    expect(await draftBrief(d, id, NOW)).toEqual({ ok: true, drafted: false })
    expect(await d.aiLog.where('job').equals('brief').count()).toBe(1)
  })
  it('a failed job saves no partial brief and reports the code and raw error', async () => {
    const d = await seededDb()
    const id = (await d.tickets.toArray())[0].id
    failHook('brief')
    expect(await draftBrief(d, id, NOW)).toEqual({ ok: false, code: 'claude_failed', error: 'fake brief unavailable' })
    expect((await d.tickets.get(id))!.brief).toBeUndefined()
  })
})

describe('learning cards must come with questions', () => {
  it('a watch card whose brief has no answers deliverable is rejected as invalid_output', async () => {
    const d = await seededDb()
    await d.tickets.put(mkTicket({ id: 'w1', kind: 'watch', title: 'W' }))
    // the fake gives a watch card answers and questions: accepted
    expect(await draftBrief(d, 'w1', NOW)).toEqual({ ok: true, drafted: true })
    expect((await d.tickets.get('w1'))!.brief!.questions.length).toBeGreaterThan(0)
  })
})

describe('R3 · Draft briefs never drafts a split part or a split parent (UAT cu-3p P2-4)', () => {
  // Sprint 1 of the small plan: split one briefed card into three parts; the rest still need a brief
  async function splitDb() {
    const d = await seededDb()
    const all = (await d.tickets.toArray()).filter(t => t.sprint === 1).sort((a, b) => a.order - b.order)
    const parent = all[0]
    await draftBrief(d, parent.id, NOW)
    const out = await splitIntoSessions(d, parent.id, 3)
    expect(out.ok).toBe(true)
    return { d, parent, others: all.slice(1) }
  }

  it('the run drafts the other cards only: the parts keep no brief of their own and their minutes stay', async () => {
    const { d, parent, others } = await splitDb()
    const parts = (await d.tickets.toArray()).filter(t => t.childOf === parent.id)
    expect(parts).toHaveLength(3)
    const before = parts.map(p => [p.id, p.estMin, minutesOf(p)])
    expect(before.reduce((a, [, , m]) => a + (m as number), 0)).toBe(minutesOf((await d.tickets.get(parent.id))!)) // 37 + 37 + 36 = 110
    const seen: string[] = []
    const sum = await draftSprint(d, 1, { now: () => NOW, onProgress: p => { if (p.title) seen.push(p.title) } })
    expect(sum).toMatchObject({ total: others.length, drafted: others.length, failed: 0 })
    expect(seen.some(t => /part \d of 3/.test(t))).toBe(false)
    const after = await d.tickets.toArray()
    const partsAfter = after.filter(t => t.childOf === parent.id)
    expect(partsAfter.map(p => p.brief)).toEqual([undefined, undefined, undefined])
    expect(partsAfter.map(p => [p.id, p.estMin, minutesOf(p)])).toEqual(before)
    // the parent's own brief is the one it had: not drafted again
    expect(after.find(t => t.id === parent.id)!.brief).toEqual((await d.tickets.get(parent.id))!.brief)
    expect(await d.aiLog.where('job').equals('brief').count()).toBe(1 + others.length)
  })

  it('a sprint whose only cards without a brief are parts has nothing to draft, and asks the AI nothing', async () => {
    const { d, parent, others } = await splitDb()
    await draftSprint(d, 1, { now: () => NOW }) // everything else drafted
    const calls = await d.aiLog.where('job').equals('brief').count()
    expect(calls).toBe(1 + others.length)
    const again = await draftSprint(d, 1, { now: () => NOW })
    expect(again).toMatchObject({ total: 0, drafted: 0, failed: 0 })
    expect(await d.aiLog.where('job').equals('brief').count()).toBe(calls)
    expect((await d.tickets.toArray()).filter(t => t.childOf === parent.id).some(p => p.brief)).toBe(false)
  })

  it('draftBrief itself never drafts a part or a container, whoever asks (the Do page, a retry)', async () => {
    const { d, parent } = await splitDb()
    const part = (await d.tickets.toArray()).find(t => t.childOf === parent.id)!
    expect(await draftBrief(d, part.id, NOW)).toEqual({ ok: true, drafted: false })
    await d.tickets.put({ ...(await d.tickets.get(parent.id))!, brief: undefined })
    expect(await draftBrief(d, parent.id, NOW)).toEqual({ ok: true, drafted: false })
    const rows = await d.tickets.toArray()
    expect(rows.find(t => t.id === part.id)!.brief).toBeUndefined()
    expect(rows.find(t => t.id === parent.id)!.brief).toBeUndefined()
    expect(await d.aiLog.where('job').equals('brief').count()).toBe(1) // only the setup draft of the parent
  })
})

describe('draftSprint', () => {
  it('drafts every unbriefed unfinished card of the sprint, with progress, and leaves other sprints alone', async () => {
    const d = await seededDb()
    const all = await d.tickets.toArray()
    const s1 = all.filter(t => t.sprint === 1)
    const seen: string[] = []
    const sum = await draftSprint(d, 1, { now: () => NOW, onProgress: p => seen.push(`${p.done}/${p.total}`) })
    expect(sum).toMatchObject({ total: s1.length, drafted: s1.length, failed: 0 })
    expect(seen[0]).toBe(`0/${s1.length}`)
    expect(seen.at(-1)).toBe(`${s1.length}/${s1.length}`)
    const after = await d.tickets.toArray()
    expect(after.filter(t => t.sprint === 1).every(t => t.brief?.status === 'draft')).toBe(true)
    expect(after.filter(t => t.sprint !== 1).some(t => t.brief)).toBe(false)
  })
  it('resumes: a second run only drafts what is missing', async () => {
    const d = await seededDb()
    const ctl = new AbortController()
    let n = 0
    const first = await draftSprint(d, 1, { now: () => NOW, signal: ctl.signal, onProgress: p => { if (p.done === 2 && ++n === 1) ctl.abort() } })
    const have = (await d.tickets.toArray()).filter(t => t.sprint === 1 && t.brief).length
    expect(first.drafted).toBe(have)
    expect(have).toBeGreaterThan(0)
    const s1 = (await d.tickets.toArray()).filter(t => t.sprint === 1).length
    const second = await draftSprint(d, 1, { now: () => NOW })
    expect(second.total).toBe(s1 - have)
    expect((await d.tickets.toArray()).filter(t => t.sprint === 1 && !t.brief)).toEqual([])
  })
  it('a failing job leaves no partial brief; the loop keeps going and reports the first error', async () => {
    const d = await seededDb()
    failHook('brief')
    const sum = await draftSprint(d, 1, { now: () => NOW })
    expect(sum.drafted).toBe(0)
    expect(sum.failed).toBe(sum.total)
    expect(sum.firstError).toEqual({ code: 'claude_failed', error: 'fake brief unavailable' })
    expect((await d.tickets.toArray()).some(t => t.brief)).toBe(false)
    expect(await d.aiLog.where('job').equals('brief').count()).toBe(sum.total)
  })
  it.each(['claude_signed_out', 'claude_missing', 'helper_unreachable'])('UAT r3 P2: %s fails every card alike, so the run stops after one call and counts them all', async code => {
    const d = await seededDb()
    failHook(`brief:${code}`)
    const seen: string[] = []
    const sum = await draftSprint(d, 1, { now: () => NOW, onProgress: p => seen.push(`${p.done}/${p.total}:${p.failed}`) })
    expect(sum.total).toBeGreaterThan(1)
    expect(sum).toMatchObject({ drafted: 0, failed: sum.total, firstError: { code } })
    expect(seen.at(-1)).toBe(`${sum.total}/${sum.total}:${sum.total}`)
    expect(await d.aiLog.where('job').equals('brief').count()).toBe(1)
  })
})

describe('editing and approving', () => {
  it('save makes it an edited draft; approve makes it approved and keeps source edited', async () => {
    const d = await seededDb()
    const id = (await d.tickets.toArray())[0].id
    await draftBrief(d, id, NOW)
    const b = (await d.tickets.get(id))!.brief!
    expect(await saveBrief(d, id, { ...b, goal: '  My own goal  ' })).toEqual({ ok: true })
    expect((await d.tickets.get(id))!.brief).toMatchObject({ goal: 'My own goal', status: 'draft', source: 'edited' })
    expect(await approveBrief(d, id)).toEqual({ ok: true })
    expect((await d.tickets.get(id))!.brief).toMatchObject({ goal: 'My own goal', status: 'approved', source: 'edited' })
    // editing an approved brief needs a fresh approval
    await saveBrief(d, id, { ...(await d.tickets.get(id))!.brief!, minutes: 90 })
    expect((await d.tickets.get(id))!.brief).toMatchObject({ minutes: 90, status: 'draft' })
  })
  it('saveBrief itself refuses a learning card without a question and an empty question', async () => {
    const d = await seededDb()
    await d.tickets.put(mkTicket({ id: 'w1', kind: 'watch', title: 'W' }))
    await draftBrief(d, 'w1', NOW)
    const b = (await d.tickets.get('w1'))!.brief!
    expect(await saveBrief(d, 'w1', { ...b, questions: [] })).toEqual({ ok: false, message: 'A learning card needs at least one question' })
    expect(await saveBrief(d, 'w1', { ...b, questions: [{ id: 'q1', kind: 'open', q: '  ' }] })).toEqual({ ok: false, message: 'Every question needs its text' })
    expect((await d.tickets.get('w1'))!.brief!.questions).toEqual(b.questions)
    // a non-learning card may drop its questions
    await d.tickets.put(mkTicket({ id: 't1', kind: 'task', title: 'T' }))
    await draftBrief(d, 't1', NOW)
    expect(await saveBrief(d, 't1', { ...(await d.tickets.get('t1'))!.brief!, questions: [] })).toEqual({ ok: true })
  })
  it('refuses a card without a brief', async () => {
    const d = await seededDb()
    const id = (await d.tickets.toArray())[0].id
    expect(await approveBrief(d, id)).toEqual({ ok: false, message: 'This card has no brief yet' })
  })
  it('cleanEdit trims question text', () => {
    const c = cleanEdit({ goal: 'g', steps: [{ text: 'a' }], minutes: 5, dayType: 'focus', learn: [], outcome: 'o', deliverable: { kind: 'answers', prompt: 'p' }, questions: [{ id: 'q1', kind: 'open', q: '  Why?  ' }] })
    expect(c.questions[0].q).toBe('Why?')
  })
  it('only http(s) links survive an edit (a javascript: href would run script)', () => {
    const c = cleanEdit({ goal: 'g', steps: [{ text: 'a', url: 'javascript:alert(1)' }, { text: 'b', url: ' data:text/html,x ' }, { text: 'c', url: 'HTTPS://ok.test/x' }, { text: 'd', url: 'ftp://x' }], minutes: 5, dayType: 'focus', learn: [], outcome: 'o', deliverable: { kind: 'note', prompt: 'p' }, questions: [] })
    expect(c.steps).toEqual([{ text: 'a' }, { text: 'b' }, { text: 'c', url: 'HTTPS://ok.test/x' }, { text: 'd' }])
  })
  it('cleanEdit trims, drops empty steps and clamps minutes', () => {
    const c = cleanEdit({
      goal: ' g ', steps: [{ text: ' a ', url: ' https://x.test ' }, { text: ' ' }, { text: 'b', url: ' ' }], minutes: 9999, dayType: 'long',
      learn: [' x ', ''], outcome: ' o ', deliverable: { kind: 'note', prompt: ' p ' }, questions: [],
    })
    expect(c).toEqual({ goal: 'g', steps: [{ text: 'a', url: 'https://x.test' }, { text: 'b' }], minutes: 480, dayType: 'long', learn: ['x'], outcome: 'o', deliverable: { kind: 'note', prompt: 'p' }, questions: [] })
  })
  it('link-check results are kept, and dropped for a link that is edited away', async () => {
    const d = await seededDb()
    const id = (await d.tickets.toArray())[0].id
    await draftBrief(d, id, NOW)
    const url = (await d.tickets.get(id))!.brief!.steps[0].url!
    await saveLinkCheck(d, id, [{ url, ok: false, status: 404 }])
    expect((await d.tickets.get(id))!.brief!.linkCheck).toEqual([{ url, ok: false, status: 404 }])
    const b = (await d.tickets.get(id))!.brief!
    await saveBrief(d, id, { ...b, steps: b.steps.map(s => ({ text: s.text })) })
    expect((await d.tickets.get(id))!.brief!.linkCheck).toBeUndefined()
  })
})
