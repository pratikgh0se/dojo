import { useEffect, useState } from 'react'
import { useDb } from '../app/providers'
import { playChime } from '../lib/chime'
import { now } from '../lib/clock'
import { Button, useToast } from '../ui/primitives'
import { Dialog } from '../screens/ai/Dialog'
import { EndLogDialog } from '../screens/do/study/EndLogDialog'
import { onEndRequest, resumeAfterAway } from './controls'
import { finishStudy, runTick, type Fx } from './runner'
import { useStudy } from './useStudy'

/**
 * Mounted in the Shell while a session exists (contract UX addendum 3, UX-12/13/14): it advances the
 * session, credits focus and chimes on every screen. With several tabs open, `navigator.locks` picks
 * one runner; the rest only follow the stored state. Without locks every tab may tick, and the
 * fresh-read, unchanged-check and idempotent focus events keep that from double-crediting.
 */
export default function StudyRunner() {
  const d = useDb()
  const toast = useToast()
  const study = useStudy()
  const [ending, setEnding] = useState(false)
  const [saving, setSaving] = useState(false)
  // ruling 24 S1: the NOW tile's End (and the Welcome back dialog's End) ask for the End session dialog from any screen
  useEffect(() => onEndRequest(() => setEnding(true)), [])
  const stored = study !== null
  useEffect(() => { if (!stored) setEnding(false) }, [stored])

  useEffect(() => {
    const fx: Fx = { chime: () => void playChime(), toast, onError: m => toast(m, 'danger') }
    const ac = new AbortController()
    let iv = 0
    const begin = () => {
      iv = window.setInterval(() => void runTick(d, now(), fx), 1000)
    }
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
    if (locks?.request) {
      locks
        .request('dojo-study-runner', { signal: ac.signal }, () => new Promise<void>(release => {
          begin()
          ac.signal.addEventListener('abort', () => release())
        }))
        .catch(() => {})
    } else begin()
    return () => {
      ac.abort()
      window.clearInterval(iv)
    }
  }, [d, toast])

  if (!study) return null
  return (
    <>
      {study.away && !ending && (
        <Dialog title="Welcome back" testId="away-dialog" onClose={() => {}}>
          <p className="study-note">You were away: Resume or End?</p>
          <div className="p-actions">
            <Button variant="accent" data-testid="away-resume" onClick={() => resumeAfterAway(now())}>Resume</Button>
            <Button data-testid="away-end" onClick={() => setEnding(true)}>End</Button>
          </div>
        </Dialog>
      )}
      {ending && (
        <EndLogDialog
          saving={saving}
          onCancel={() => setEnding(false)}
          onSave={log => {
            setSaving(true)
            void finishStudy({ d, log, nowMs: now(), chime: () => {}, toast, onError: m => toast(m, 'danger') })
              .then(ok => { if (ok) setEnding(false) })
              .finally(() => setSaving(false))
          }}
        />
      )}
    </>
  )
}
