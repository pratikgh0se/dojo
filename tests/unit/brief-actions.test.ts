import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { approveBrief, draftBrief, draftSprint, saveBrief, saveLinkCheck, cleanEdit } from '../../src/data/briefActions'
import { FAKE_FAIL_KEY, fakeOutput } from '../../src/ai/fake'
import { isDraftable, toBrief } from '../../src/rules/brief'
import { seededDb } from '../helpers/db'
import { mkTicket } from '../helpers/tickets'

const NOW = 1_800_000_000_000
const failHook = (v: string | null) => { if (v === null) localStorage.removeItem(FAKE_FAIL_KEY); else localStorage.setItem(FAKE_FAIL_KEY, v) }
beforeEach(() => failHook(null))
afterEach(() => failHook(null))

describe('draftBrief', () => {
  it('drafts a problem and logs one aiLog row', async () => {
    const d = await seededDb()
    const t = mkTicket({ id: 'k1', kind: 'problem', track: 'interview', title: 'Number of Islands' })
    await d.tickets.put(t)
    expect(await draftBrief(d, t.id, NOW)).toEqual({ ok: true, drafted: true })
    const b = (await d.tickets.get(t.id))!.brief!
    expect(b).toMatchObject({ status: 'draft', source: 'ai', minutes: 60, dayType: 'focus', goal: `Understand ${t.title}` })
    expect(await d.aiLog.where('job').equals('brief').count()).toBe(1)
  })
  it('never drafts a watch, read, build, writeup or ritual ticket: they use their own text, links and explain[]', async () => {
    const d = await seededDb()
    const kinds = ['watch', 'read', 'build', 'writeup', 'ritual'] as const
    for (const kind of kinds) await d.tickets.put(mkTicket({ id: `x-${kind}`, kind, title: kind }))
    for (const kind of kinds) expect(await draftBrief(d, `x-${kind}`, NOW)).toEqual({ ok: true, drafted: false })
    expect(await d.aiLog.where('job').equals('brief').count()).toBe(0)
  })
  it('a model output that misses its steps is refused as invalid_output and saves nothing (BR-20)', async () => {
    const d = await seededDb()
    await d.tickets.put(mkTicket({ id: 'p', track: 'interview', kind: 'problem', title: 'Two Sum' }))
    try {
      localStorage.setItem('dojo:fake-ai-brief', 'invalid')
      const r = await draftBrief(d, 'p', NOW)
      expect(r).toMatchObject({ ok: false, code: 'invalid_output' })
      expect(r.ok === false && r.error).toContain('steps')
      expect((await d.tickets.get('p'))!.brief).toBeUndefined()
    } finally { localStorage.removeItem('dojo:fake-ai-brief') }
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

describe('draftSprint', () => {
  it('drafts every unbriefed unfinished card of the sprint, with progress, and leaves other sprints alone', async () => {
    const d = await seededDb()
    const all = await d.tickets.toArray()
    const s1 = all.filter(t => t.sprint === 1 && isDraftable(t)) // watch, read and build cards are not drafted (spec 3.2)
    const seen: string[] = []
    const sum = await draftSprint(d, 1, { now: () => NOW, onProgress: p => seen.push(`${p.done}/${p.total}`) })
    expect(sum).toMatchObject({ total: s1.length, drafted: s1.length, failed: 0 })
    expect(seen[0]).toBe(`0/${s1.length}`)
    expect(seen.at(-1)).toBe(`${s1.length}/${s1.length}`)
    const after = await d.tickets.toArray()
    expect(after.filter(t => t.sprint === 1 && isDraftable(t)).every(t => t.brief?.status === 'draft')).toBe(true)
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
    const s1 = (await d.tickets.toArray()).filter(t => t.sprint === 1 && isDraftable(t)).length
    const second = await draftSprint(d, 1, { now: () => NOW })
    expect(second.total).toBe(s1 - have)
    expect((await d.tickets.toArray()).filter(t => t.sprint === 1 && isDraftable(t) && !t.brief)).toEqual([])
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
    // a watch card is not drafted any more; give it a brief with answers and questions directly
    const w = mkTicket({ id: 'w1', kind: 'watch', title: 'W' })
    await d.tickets.put({ ...w, brief: toBrief(fakeOutput('brief', { ticket: { id: w.id, title: w.title, track: w.track }, context: { kind: 'watch', learning: true, estMin: 50 } })) })
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
