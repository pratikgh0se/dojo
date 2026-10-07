import { useMemo, useSyncExternalStore } from 'react'
import { isStudy, markProgress, dismissStuck, setChime, takeBreak, type Study } from '../rules/studySession'
import { STUDY_KEY, subscribeStudy, updateStudy } from '../lib/studyStore'

function read(): string | null {
  try {
    return localStorage.getItem(STUDY_KEY)
  } catch {
    return null
  }
}

/** The stored session, live: it changes when any tab, or the runner, writes it. */
export function useStudy(): Study | null {
  const raw = useSyncExternalStore(subscribeStudy, read, () => null)
  return useMemo(() => {
    try {
      const v: unknown = raw ? JSON.parse(raw) : null
      return isStudy(v) ? v : null
    } catch {
      return null
    }
  }, [raw])
}

/** The session as one Do screen sees it: `study` when it is on this ticket, `other` when it is on another. */
export function useStudyFor(ticketId: string) {
  const cur = useStudy()
  const study = cur && cur.ticketId === ticketId ? cur : null
  return {
    study,
    other: cur && cur.ticketId !== ticketId ? cur : null,
    active: study !== null,
    mark: () => void updateStudy(markProgress),
    dismissStuck: () => void updateStudy(dismissStuck),
    takeBreak: (at: number) => void updateStudy(s => takeBreak(s, at)),
    setChime: (on: boolean) => void updateStudy(s => setChime(s, on)),
  }
}
