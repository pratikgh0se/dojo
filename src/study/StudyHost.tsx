import { lazy, Suspense, useEffect, useState } from 'react'
import { STUDY_KEY, subscribeStudy } from '../lib/studyStore'

const StudyRunner = lazy(() => import('./StudyRunner'))

const exists = (): boolean => {
  try {
    return localStorage.getItem(STUDY_KEY) !== null
  } catch {
    return false
  }
}

/** Mounts the study runner (a lazy chunk) only while a session is stored, so idle screens pay nothing. */
export function StudyHost() {
  const [on, setOn] = useState(exists)
  useEffect(() => subscribeStudy(() => setOn(exists())), [])
  return on ? <Suspense fallback={null}><StudyRunner /></Suspense> : null
}
