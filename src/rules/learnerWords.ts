/** The AI job is stored under the name `interview`; a learner never reads that word (GLOBAL-01), so text the model wrote is shown with
 * "session" or "partner" in its place (display only for a stored grade; a review card's piece is stored this way). */
export const learnerWords = (raw: string): string =>
  raw.replace(/\binterview\w*/gi, w => {
    const lower = w.toLowerCase()
    const word = lower === 'interviewer' ? 'partner' : lower === 'interviewers' ? 'partners' : lower === 'interviews' ? 'sessions' : 'session'
    return w[0] === w[0].toUpperCase() ? word[0].toUpperCase() + word.slice(1) : word
  })
