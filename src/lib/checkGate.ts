// A learning card with a brief is finished through its check. Anything that would tick it (a Today or Board
// checkbox, a drag to Done, Solved on Do) asks for the check dialog instead; the CheckGate in the shell opens it.
export const OPEN_CHECK_EVENT = 'dojo:open-check'
export const openCheck = (ticketId: string): void => { window.dispatchEvent(new CustomEvent(OPEN_CHECK_EVENT, { detail: ticketId })) }
