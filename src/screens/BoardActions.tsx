import { useRef, useState } from 'react'
import { useDb } from '../app/providers'
import { shiftPlanAction, slideSprintAction, undoLast } from '../data/boardActions'
import { safeWrite } from '../data/safeWrite'
import type { StoredEvent, Ticket } from '../data/types'
import { now } from '../lib/clock'
import { minutesOf } from '../rules/brief'
import { slideSprintPreview, undoableSteps, undoLabel } from '../rules/slide'
import { partsUnstarted } from '../data/splitActions'
import { APP_SESSION } from '../data/undoSession'
import { hoursText, plannedMinutes } from '../rules/workload'
import { Button, useToast } from '../ui/primitives'
import { tipProps } from '../ui/Tip'
import { Dialog } from './ai/Dialog'

const cards = (n: number) => `${n} ${n === 1 ? 'card' : 'cards'}`

export function BoardActions({
  sprint, current, tickets, events,
}: { sprint: number; current: number; tickets: Ticket[] | undefined; events: StoredEvent[] | undefined }) {
  const d = useDb()
  const toast = useToast()
  const [asking, setAsking] = useState<'slide' | 'shift' | null>(null)
  const slideBtn = useRef<HTMLButtonElement>(null)
  const shiftBtn = useRef<HTMLButtonElement>(null)
  const shiftCancel = useRef<HTMLButtonElement>(null)
  if (!tickets || !events) return null

  const preview = slideSprintPreview(tickets, sprint, current)
  // DL11: the confirm shows the resulting size of the target sprint, in cards and hours.
  const movingMinutes = tickets.filter(t => !t.archived && t.sprint === sprint && t.status !== 'done').reduce((a, t) => a + minutesOf(t), 0)
  const targetHours = hoursText(plannedMinutes(tickets, preview.to) + movingMinutes)
  // ruling 20 S6: this session's steps only; a split stays undoable while none of its parts has been started
  const steps = undoableSteps(events, { appSession: APP_SESSION, blocked: e => e.t === 'split' && !partsUnstarted(tickets, e.parts) })
  const undoable = steps.length
  const undoText = undoLabel(steps[0], tickets)
  const shiftFrom = Math.max(sprint, current)
  const onError = (m: string) => toast(m, 'danger')

  async function onSlideSprint() {
    if (preview.count === 0) {
      toast(`Nothing to slide in S${sprint}`, 'warn')
      return
    }
    setAsking('slide')
  }

  async function doSlide() {
    setAsking(null)
    const r = await safeWrite(() => slideSprintAction(d, sprint, now(), current), onError)
    if (r?.ok) toast(`Slid ${r.count} to S${preview.to}`)
    else if (r) toast(r.message, 'warn')
  }

  async function doShift() {
    setAsking(null)
    const r = await safeWrite(() => shiftPlanAction(d, shiftFrom, now(), current), onError)
    if (r?.ok) toast(`Shifted ${r.count} tickets`)
    else if (r) toast(r.message, 'warn')
  }

  async function onUndo() {
    const r = await safeWrite(() => undoLast(d, now()), onError)
    if (r?.ok) toast('Undone')
    else if (r) toast(r.message, 'warn')
  }

  return (
    <div className="board-actions">
      <Button ref={slideBtn} onClick={() => void onSlideSprint()}>Slide sprint ›</Button>
      <Button ref={shiftBtn} onClick={() => setAsking('shift')}>Shift plan ›</Button>
      {/* ruling 20 S6: the button names the action it will undo (title and aria-label); cu-3 P2-1: and the page shows it on hover */}
      <Button variant="quiet" onClick={() => void onUndo()} disabled={undoable === 0} aria-label={undoText} {...tipProps(undoText)} data-testid="undo">Undo ({undoable})</Button>
      {asking === 'slide' && (
        <Dialog title="Slide sprint?" testId="slide-dialog" onClose={() => setAsking(null)} returnFocus={() => slideBtn.current}>
          <p className="dl-text">
            Move {preview.count} unfinished {preview.count === 1 ? 'card' : 'cards'} from S{sprint} to S{preview.to}? S{preview.to} will
            have {cards(preview.resultingSize)} ({targetHours} h).
          </p>
          <div className="p-actions">
            <Button variant="accent" onClick={() => void doSlide()}>Slide {cards(preview.count)}</Button>
            <Button variant="quiet" onClick={() => setAsking(null)}>Cancel</Button>
          </div>
        </Dialog>
      )}
      {asking === 'shift' && (
        <Dialog title="Shift plan?" testId="shift-dialog" onClose={() => setAsking(null)} returnFocus={() => shiftBtn.current} initialFocus={() => shiftCancel.current}>
          <p className="dl-text">Shift every unfinished ticket from S{shiftFrom} onward by one sprint?</p>
          <div className="p-actions">
            <Button variant="accent" onClick={() => void doShift()}>Shift plan</Button>
            <Button ref={shiftCancel} variant="quiet" onClick={() => setAsking(null)}>Cancel</Button>
          </div>
        </Dialog>
      )}
    </div>
  )
}
