import type { Difficulty, PlanJson, Ticket } from '../data/types'
import { liveTicketMap } from './board'

export const DIFFICULTIES: readonly Difficulty[] = ['E', 'M', 'H']

export const DIFFICULTY_LABELS: Record<Difficulty, string> = { E: 'Easy', M: 'Medium', H: 'Hard' }

export interface DsaProblemView {
  id: string
  num: number
  name: string
  url: string
  difficulty: Difficulty
  premium: boolean
  neetcode: string | null
  ticket: Ticket | null
  solved: boolean
}

export interface DsaTopicView {
  sprint: number
  topic: string
  pattern: string
  note: string
  problems: DsaProblemView[]
  solved: number
  total: number
}

export interface DsaTotals {
  solved: number
  total: number
  hardSolved: number
  premiumLeft: number
  byDifficulty: Record<Difficulty, { solved: number; total: number }>
}

const LEETCODE_PROBLEM = /^https?:\/\/(?:www\.)?leetcode\.com\/problems\/([a-z0-9-]+)(?:[/?#]|$)/i

export function neetcodeUrl(leetcodeUrl: string): string | null {
  const m = LEETCODE_PROBLEM.exec(leetcodeUrl.trim())
  return m ? `https://neetcode.io/solutions/${m[1].toLowerCase()}` : null
}

export function dsaTopics(plan: PlanJson, tickets: Ticket[]): DsaTopicView[] {
  const byId = liveTicketMap(tickets)
  return plan.dsa_bank
    .map(w => {
      const problems: DsaProblemView[] = w.problems.map(p => {
        const id = `p${p.num}`
        const ticket = byId.get(id) ?? null
        return {
          id, num: p.num, name: p.name, url: p.url, difficulty: p.difficulty, premium: p.premium === true,
          neetcode: neetcodeUrl(p.url), ticket, solved: ticket?.status === 'done',
        }
      })
      return {
        sprint: w.sprint, topic: w.topic, pattern: w.pattern, note: w.note, problems,
        solved: problems.filter(p => p.solved).length, total: problems.length,
      }
    })
    .sort((a, b) => a.sprint - b.sprint)
}

export function dsaTotals(topics: DsaTopicView[]): DsaTotals {
  const byDifficulty: DsaTotals['byDifficulty'] = { E: { solved: 0, total: 0 }, M: { solved: 0, total: 0 }, H: { solved: 0, total: 0 } }
  let solved = 0
  let total = 0
  let hardSolved = 0
  let premiumLeft = 0
  for (const p of topics.flatMap(t => t.problems)) {
    total++
    byDifficulty[p.difficulty].total++
    if (p.solved) {
      solved++
      byDifficulty[p.difficulty].solved++
      if (p.difficulty === 'H') hardSolved++
    } else if (p.premium && p.ticket) {
      premiumLeft++
    }
  }
  return { solved, total, hardSolved, premiumLeft, byDifficulty }
}
