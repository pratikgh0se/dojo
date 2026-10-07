import type { Ticket } from '../data/types'

// UAT J3: the plan's ticket text ends with the forge brief's repo path ("The brief is
// forge/stages/00-setup/brief.md"). That is for the plan's authors, not the learner: every screen shows the
// text without it. The stored text is unchanged (the brief drafting reads it).
const BRIEF_PATH = /\s*The brief is \S+?\.md\b\.?/g

export function shownText(text: string | undefined | null): string {
  return (text ?? '').replace(BRIEF_PATH, '').trim()
}

/** A watch stage types along with its reference unless its own text says the references are videos only (stage 00). */
export function typesAlong(t: Ticket): boolean {
  return !/not code to type along/i.test(t.text ?? '')
}
