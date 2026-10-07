import type { Link, PlanLearner } from '../data/types'
import type { ProseSection } from './types'

export const DSA_RESOURCES: Record<string, Link> = {
  neet: { label: 'NeetCode roadmap', url: 'https://neetcode.io/roadmap' },
  dg: { label: 'Design Gurus: Grokking the Coding Interview', url: 'https://www.designgurus.io/course/grokking-the-coding-interview' },
  striverdp: { label: 'Striver DP series', url: 'https://takeuforward.org/dynamic-programming/striver-dp-series-dynamic-programming-problems/' },
  strivergraph: { label: 'Striver graph series', url: 'https://takeuforward.org/graph/striver-graph-series-top-graph-tutorials/' },
  fiset: { label: 'William Fiset graph theory', url: 'https://www.youtube.com/playlist?list=PLDV1Zeh2NRsDGO4--qE8yH72HFL1Km93P' },
}

/** DSA topic sprint (dsa_bank[].sprint) → resource keys, in extra.json order. */
export const DSA_LEARN: Record<number, string[]> = {
  1: ['fiset', 'strivergraph'],
  2: ['fiset', 'strivergraph'],
  3: ['fiset', 'strivergraph'],
  4: ['fiset'],
  5: ['neet'],
  6: ['neet'],
  7: ['striverdp'],
  8: ['striverdp'],
  9: ['striverdp', 'dg'],
  10: ['striverdp'],
  11: ['dg', 'neet'],
  12: ['dg', 'neet'],
  16: ['neet'],
  15: ['dg', 'grok'],
  18: ['dg', 'grok'],
  20: ['dg', 'grok'],
  24: ['dg', 'neet'],
}

/** G6: the learner's own links, keyed like DSA_RESOURCES; a key with no URL in the plan's `learner` block is left out. */
export const LEARNER_RESOURCES: Record<string, { label: string; key: keyof PlanLearner }> = {
  grok: { label: 'your grokking-patterns repo', key: 'patternsRepo' },
}

export function learnLinks(topicSprint: number, learner?: PlanLearner): Link[] {
  const resolve = (k: string): Link | undefined => {
    const own = LEARNER_RESOURCES[k]
    if (!own) return DSA_RESOURCES[k]
    const url = learner?.[own.key]
    return url ? { label: own.label, url } : undefined
  }
  return (DSA_LEARN[topicSprint] ?? []).map(resolve).filter((l): l is Link => l !== undefined)
}

export const DSA_INTRO: ProseSection = {
  title: 'Hard first, basics to high inside each topic',
  intro:
    'Graphs, then trees, then four weeks of dynamic programming, then heaps and the three invariant patterns. The easy patterns come later as one-week sweeps. Every week opens by writing the core algorithm from memory before any problem. Tick problems here; the count feeds the skill tree.',
  items: [],
  outro: "Difficulty tags are LeetCode's. P marks a premium problem; skip it if you do not subscribe.",
}

export const DSA_SOURCES: ProseSection = {
  title: 'Which sources, and why',
  items: [
    {
      lead: 'Design Gurus Grokking',
      text: 'for the pattern names and its knapsack and heap chapters. Its problem depth stops at medium, so it is the map, not the road.',
      links: [{ label: 'course', url: 'https://www.designgurus.io/course/grokking-the-coding-interview' }],
    },
    {
      lead: 'This bank',
      text: 'is the road: direct LeetCode links, hard-first. NeetCode videos are the explanation layer when a problem beats you.',
      links: [{ label: 'roadmap', url: 'https://neetcode.io/roadmap' }],
    },
    {
      lead: "Striver's DP series",
      text: 'for dynamic programming: recursion to tabulation to space optimization on every problem.',
      links: [{ label: 'series', url: 'https://takeuforward.org/dynamic-programming/striver-dp-series-dynamic-programming-problems/' }],
    },
    {
      lead: "William Fiset's graph theory playlist",
      text: 'for advanced graphs: Dijkstra, Bellman-Ford, Tarjan, Eulerian paths, MST, done properly.',
      links: [{ label: 'playlist', url: 'https://www.youtube.com/playlist?list=PLDV1Zeh2NRsDGO4--qE8yH72HFL1Km93P' }],
    },
    {
      lead: 'Skip',
      text: "AlgoMonster (overlaps Grokking) and LeetCode's own explore cards. LeetCode Premium only matters for the nine premium problems marked P; skip them until you decide to buy it.",
    },
  ],
}
