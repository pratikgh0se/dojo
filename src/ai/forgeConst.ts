// The two strings a forge brief's deliverable is built from. Kept apart from guardrails.ts so the entry chunk
// can use them without pulling the prompt text in.
export const FORGE_TYPED_BY_HAND = 'your own code, typed by hand'
/** The one deliverable prompt a forge / AI-track brief may carry (contracts/briefs.md BR-15 and the pinned fake). */
export const FORGE_DELIVERABLE_PROMPT = 'Paste your code, typed by hand'
/** UAT cu-5 P2-2: a teach-back card hands in a written explanation (or the words for a sketch), never code. */
export const TEACHBACK_DELIVERABLE_PROMPT = 'Explain it in your own words'
