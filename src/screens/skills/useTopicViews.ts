import { useMemo } from 'react'
import { useAllCheckAttempts, useAllLabRuns, useLabInfos, useLabReviews } from '../../data/labHooks'
import type { PlanV2 } from '../../data/planV2'
import type { Ticket } from '../../data/types'
import { labIdsOf } from '../../rules/labView'
import { isTreeArea } from '../../rules/skillView'
import { nextStepLine, TOPIC_WORD, topicState, type TopicState } from '../../rules/topicState'

export interface TopicView { state: TopicState | null; line: string | null }

/** `<title>, <state>` plus the topic word when the node has one: the accessible name of a node (SKILLS-22). */
export const withTopicWord = (name: string, topic: TopicState | null | undefined): string => (topic ? `${name}, ${TOPIC_WORD[topic]}` : name)

/** The topic state and next-step line of every AI node (the DSA and Design trees keep their node states only). `undefined` until everything has loaded. */
export function useTopicViews(plan: PlanV2, tickets: readonly Ticket[]): ReadonlyMap<string, TopicView> | undefined {
  const attempts = useAllCheckAttempts()
  const runs = useAllLabRuns()
  const reviews = useLabReviews()
  const infos = useLabInfos(labIdsOf(tickets))
  return useMemo(() => {
    if (!attempts || !runs || !reviews || !infos) return undefined
    return new Map(plan.nodes.filter(n => !isTreeArea(n.area)).map(n => {
      const state = topicState(n, tickets, attempts, runs, reviews, infos)
      return [n.id, { state, line: nextStepLine(n, state, tickets, runs, reviews, infos) }] as const
    }))
  }, [plan, tickets, attempts, runs, reviews, infos])
}
