import type { AiTicket, DiagramJson, SlideCandidate, SrAlgoJson } from '../ai/types'
import type { Link, PlanJson, Ticket } from '../data/types'
import { leftBehind } from './load'
import { sprintTaskWork } from './vitals'

export const NO_WATCH_LINK = 'No watch link for this task'
export const NO_VIDEO = 'No video for this task'
/** AI "solution": 2 of 3 quiz answers mark the session understood. */
export const QUIZ_PASS = 2
/** AI guardrail 3: pseudocode ≤ 15 lines. */
export const PSEUDOCODE_MAX_LINES = 15

const isWeb = (u: string) => /^https?:\/\//i.test(u)
const web = (ls: Link[]) => ls.filter(l => isWeb(l.url))
export const isYouTube = (u: string): boolean => /^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(u)

export function leetcodeSlug(url: string): string | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (!/(^|\.)leetcode\.com$/i.test(u.hostname)) return null
  const segs = u.pathname.split('/').filter(Boolean)
  const i = segs.indexOf('problems')
  if (i >= 0 && segs[i + 1]) return segs[i + 1]
  return segs.length ? segs[segs.length - 1] : null
}

export function neetcodeLink(t: Ticket): Link | null {
  for (const l of t.links) {
    const slug = leetcodeSlug(l.url)
    if (slug) return { label: 'NeetCode solution', url: `https://neetcode.io/solutions/${slug}` }
  }
  return null
}

/** C-LADDER §4: the paired watch ticket is the same id with -rebuild/-build replaced by -watch. */
export function pairedWatchId(id: string): string | null {
  const w = id.replace(/-(rebuild|build)$/, '-watch')
  return w === id ? null : w
}

export function videoLinks(t: Ticket, pair: Ticket | null): Link[] {
  if (t.kind === 'problem') {
    const nc = neetcodeLink(t)
    return [...(nc ? [nc] : []), ...web(t.links)]
  }
  if (t.kind === 'design') return web(t.links)
  const own = t.links.filter(l => isYouTube(l.url))
  if (own.length) return own
  return pair ? pair.links.filter(l => isYouTube(l.url)) : []
}

export function taskPictureLinks(t: Ticket, pair: Ticket | null): Link[] {
  if (pair && web(pair.links).length) return web(pair.links)
  return web(t.links)
}

export function normaliseAnswer(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '').trim()
}

export function quizScore(quiz: { q: string; a: string }[], answers: string[]): number {
  return quiz.reduce((k, item, i) => {
    const given = normaliseAnswer(answers[i] ?? '')
    return k + (given !== '' && given === normaliseAnswer(item.a) ? 1 : 0)
  }, 0)
}

export const quizResultText = (k: number): string => (k >= QUIZ_PASS ? `Understood · ${k}/3` : `${k}/3 · try again`)

export function aiTrack(t: Ticket): AiTicket['track'] {
  if (t.kind === 'problem') return 'dsa'
  if (t.kind === 'design') return 'design'
  return t.track === 'ai' ? 'ai' : 'interview'
}

export function aiTicketOf(t: Ticket): AiTicket {
  return {
    id: t.id, title: t.title, track: aiTrack(t),
    ...(t.text ? { text: t.text } : {}),
    ...(t.pattern ? { pattern: t.pattern } : {}),
    ...(t.difficulty ? { difficulty: t.difficulty } : {}),
    links: t.links,
  }
}

export interface PictureSummary { steps: number; caption: string }
export function pictureSummary(json: SrAlgoJson): PictureSummary {
  const steps = json.steps.length
  return { steps, caption: `Generated picture · ${steps} steps` }
}

export interface DiagramSummary { nodes: number; links: number; caption: string; labels: string[] }
export function diagramSummary(json: DiagramJson): DiagramSummary {
  const nodes = json.nodes.length
  const links = json.links.length
  return { nodes, links, caption: `Reference architecture · ${nodes} nodes · ${links} links`, labels: json.nodes.map(n => n.label ?? n.id) }
}

export function designDeepDives(plan: PlanJson, id: string): string[] {
  for (const tier of plan.design_bank) {
    const it = tier.items.find(x => x.id === id)
    if (it) return [...it.deep_dives]
  }
  return []
}

/**
 * Due tickets for suggest_slide (C-LADDER §7.3): left behind, then remaining this sprint. `inUse`: the cards being worked
 * on right now (a running session or timer) are not offered: sliding the card in the learner's hands is never the advice
 * (UAT cu-2 P3-5).
 */
export function slideCandidates(tickets: Ticket[], sprint: number, inUse: ReadonlySet<string> = new Set()): SlideCandidate[] {
  // the work that can slide: a split card's open parts, not the card (ruling 20 S4)
  const due = [...leftBehind(tickets, sprint, true), ...sprintTaskWork(tickets, sprint).filter(t => t.status !== 'done')].filter(t => !inUse.has(t.id))
  return due.map(t => ({
    id: t.id, title: t.title, track: aiTrack(t), estMin: t.estMin,
    ...(t.difficulty ? { difficulty: t.difficulty } : {}),
    slidCount: t.slidFrom.length,
  }))
}
