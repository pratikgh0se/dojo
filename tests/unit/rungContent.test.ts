import { describe, expect, it } from 'vitest'
import type { DiagramJson, SrAlgoJson } from '../../src/ai/types'
import {
  aiTicketOf, designDeepDives, diagramSummary, leetcodeSlug, normaliseAnswer, pairedWatchId, pictureSummary,
  quizResultText, quizScore, slideCandidates, taskPictureLinks, videoLinks,
} from '../../src/rules/rungContent'
import { smallPlan } from '../helpers/plan'
import { mkTicket } from '../helpers/tickets'

const p200 = mkTicket({ id: 'p200', kind: 'problem', track: 'interview', title: '200 · Number of Islands', difficulty: 'M', links: [{ label: 'LeetCode 200', url: 'https://leetcode.com/problems/number-of-islands/' }] })
const watch = mkTicket({ id: 'stage-00-setup-w1-watch', kind: 'stage', links: [
  { label: '3Blue1Brown calculus', url: 'https://www.3blue1brown.com/topics/calculus' },
  { label: '3Blue1Brown neural nets', url: 'https://www.3blue1brown.com/topics/neural-networks' },
] })
const rebuild = mkTicket({ id: 'stage-00-setup-w1-rebuild', kind: 'stage', links: [] })

describe('links', () => {
  it('NeetCode slug from the problem segment, including extra segments and a query (Review Focus 4)', () => {
    expect(leetcodeSlug('https://leetcode.com/problems/number-of-islands/')).toBe('number-of-islands')
    expect(leetcodeSlug('https://leetcode.com/problems/two-sum/description/?envType=study-plan')).toBe('two-sum')
    expect(leetcodeSlug('https://example.com/problems/x')).toBeNull()
    expect(leetcodeSlug('not a url')).toBeNull()
  })
  it('H-08 DSA video: NeetCode solution first, then the plan links', () => {
    expect(videoLinks(p200, null)).toEqual([
      { label: 'NeetCode solution', url: 'https://neetcode.io/solutions/number-of-islands' },
      { label: 'LeetCode 200', url: 'https://leetcode.com/problems/number-of-islands/' },
    ])
  })
  it('H-12 design video: its refs', () => {
    const d = mkTicket({ id: 'd-method', kind: 'design', links: [{ label: 'Hello Interview free guides', url: 'https://www.hellointerview.com/x' }, { label: 'bank', url: '#bank' }] })
    expect(videoLinks(d, null).map(l => l.label)).toEqual(['Hello Interview free guides'])
  })
  it('H-13 task: paired watch links for Picture, YouTube only for Video', () => {
    expect(pairedWatchId('stage-00-setup-w1-rebuild')).toBe('stage-00-setup-w1-watch')
    expect(pairedWatchId('stage-00-setup-w1-build')).toBe('stage-00-setup-w1-watch')
    expect(pairedWatchId('m1w1t1')).toBeNull()
    expect(taskPictureLinks(rebuild, watch).map(l => l.label)).toEqual(['3Blue1Brown calculus', '3Blue1Brown neural nets'])
    expect(taskPictureLinks(rebuild, null)).toEqual([])
    expect(videoLinks(rebuild, watch)).toEqual([])
    const yt = mkTicket({ id: 'x-watch', kind: 'stage', links: [{ label: 'Karpathy', url: 'https://www.youtube.com/watch?v=abc' }] })
    expect(videoLinks(rebuild, yt).map(l => l.label)).toEqual(['Karpathy'])
  })
})

describe('quiz', () => {
  const quiz = [{ q: 'a?', a: 'best holds the answer so far' }, { q: 'b?', a: 'one' }, { q: 'c?', a: 'O(1)' }]
  it('H-11 compares loosely: case, spaces, trailing period', () => {
    expect(normaliseAnswer('  Best  HOLDS the answer so far. ')).toBe('best holds the answer so far')
    expect(quizScore(quiz, ['  Best  HOLDS the answer so far. ', 'ONE', 'O(n)'])).toBe(2)
    expect(quizScore(quiz, ['best holds the answer so far', 'two', ''])).toBe(1)
    expect(quizScore(quiz, ['', '', ''])).toBe(0)
    expect(quizResultText(2)).toBe('Understood · 2/3')
    expect(quizResultText(1)).toBe('1/3 · try again')
  })
})

describe('AI mapping and summaries', () => {
  it('maps ticket kinds to AI tracks', () => {
    expect(aiTicketOf(p200)).toMatchObject({ id: 'p200', title: '200 · Number of Islands', track: 'dsa', difficulty: 'M' })
    expect(aiTicketOf(mkTicket({ id: 'd', kind: 'design' })).track).toBe('design')
    expect(aiTicketOf(rebuild).track).toBe('ai')
    expect(aiTicketOf(mkTicket({ id: 'i', kind: 'task', track: 'interview' })).track).toBe('interview')
  })
  it('summarises a picture and a diagram (C-LADDER §5)', () => {
    const pic = { steps: Array.from({ length: 15 }, (_, i) => ({ op: 'mark', say: `step ${i}` })) } as unknown as SrAlgoJson
    expect(pictureSummary(pic)).toEqual({ steps: 15, caption: 'Generated picture · 15 steps' })
    const dia = { layout: 'layered', nodes: [{ id: 'a', kind: 'browser', label: 'Client' }, { id: 'b', kind: 'service', label: 'Service' }], links: [{ from: 'a', to: 'b', kind: 'sync' }] } as unknown as DiagramJson
    expect(diagramSummary(dia)).toEqual({ nodes: 2, links: 1, caption: 'Reference architecture · 2 nodes · 1 links', labels: ['Client', 'Service'] })
  })
  it('reads a design’s deep dives from the plan', () => {
    expect(designDeepDives(smallPlan, 'd-method')).toEqual(['Requirements', 'API first', 'One deep dive', 'Failure modes'])
    expect(designDeepDives(smallPlan, 'nope')).toEqual([])
  })
  it('slide candidates are left-behind then remaining current tasks', () => {
    const ts = [
      mkTicket({ id: 'a', sprint: 1, order: 1 }), mkTicket({ id: 'b', sprint: 2, order: 2, slidFrom: [1] }),
      mkTicket({ id: 'c', sprint: 2, order: 3, status: 'done' }), mkTicket({ id: 'p1', kind: 'problem', sprint: 1 }),
    ]
    expect(slideCandidates(ts, 2)).toEqual([
      { id: 'a', title: 'a', track: 'ai', estMin: 50, slidCount: 0 },
      { id: 'b', title: 'b', track: 'ai', estMin: 50, slidCount: 1 },
    ])
  })
  it('never offers a card that is in use (cu-2 P3-5): the one a session or timer is running on', () => {
    const ts = [mkTicket({ id: 'a', sprint: 1, order: 1 }), mkTicket({ id: 'b', sprint: 2, order: 2 }), mkTicket({ id: 'c', sprint: 2, order: 3 })]
    expect(slideCandidates(ts, 2, new Set(['b'])).map(c => c.id)).toEqual(['a', 'c'])
    expect(slideCandidates(ts, 2, new Set()).map(c => c.id)).toEqual(['a', 'b', 'c'])
  })
})
