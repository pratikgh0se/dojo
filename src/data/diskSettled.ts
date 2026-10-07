// Ruling 9 renders a local copy before the first disk sync is done. Writes that derive from the database (the
// roll-over, automatic reviews) must wait for that sync: a write made between its outbox flush and its replace of
// the working copy would be overwritten by the disk's state (shell-today-board rerun: the roll-over line went
// missing). main.tsx registers the pending sync here; everything else awaits `whenDiskSettled()`.
let settled: Promise<void> = Promise.resolve()

export function setDiskSettling(p: Promise<unknown>): void {
  settled = p.then(() => undefined, () => undefined)
}

export function whenDiskSettled(): Promise<void> {
  return settled
}
