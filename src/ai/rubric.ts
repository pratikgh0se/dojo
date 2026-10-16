// The design session's 20-point rubric (chain D RUBRIC_BREAKDOWN; item names = the fake grade's). Its own module so that the rules
// that need only the maxima (rules/designSession, rules/partnerScores) do not pull ai/prompts, ai/fake and ai/validate into the entry chunk.
export const INTERVIEW_RUBRIC = [
  { item: 'Requirements and numbers', max: 4 },
  { item: 'API and data model', max: 3 },
  { item: 'High-level design that meets the numbers', max: 4 },
  { item: 'Two deep dives with real trade-offs', max: 6 },
  { item: 'Failure modes and operations', max: 3 },
] as const
