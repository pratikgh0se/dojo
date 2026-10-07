import type { ArtifactStatus } from '../data/types'

/** TRACKING §1 "The 5-question close", fixed text (design contract D-25). */
export const CLOSE_QUESTIONS = [
  'What was the hardest trade-off and which side did you take?',
  'What breaks first at 10× load, and what would you change?',
  'Where is the data, who owns it, and what is eventually consistent?',
  'Which deep dive could you not answer without notes?',
  'One thing you would read next.',
] as const

/** TRACKING §2 "Build board" column order. */
export const ARTIFACT_STATUSES: readonly ArtifactStatus[] = ['not started', 'building', 'runs', 'measured', 'written up']
