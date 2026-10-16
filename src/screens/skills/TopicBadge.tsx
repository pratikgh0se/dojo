import { TOPIC_WORD, type TopicState } from '../../rules/topicState'

/** The computed topic state (Learning, Learned, Built, Proven) beside a node's own state; nothing when no ticket of the node was touched. */
export function TopicBadge({ id, topic }: { id: string; topic: TopicState | null | undefined }) {
  if (!topic) return null
  return <span className="sk-topic" data-testid={`skills-node-badge-${id}`} data-topic-state={topic}>{TOPIC_WORD[topic]}</span>
}
