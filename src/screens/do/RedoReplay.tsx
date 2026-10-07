import type { Ticket } from '../../data/types'
import { PicturePlayer, type PictureJson } from './PicturePlayer'

/** The paid picture of an earlier cycle, if any (AI "UI contract": outputs are stored on the ticket). */
export function replayPicture(ticket: Ticket): PictureJson | null {
  if (ticket.kind === 'problem' && ticket.ai?.picture) return { kind: 'dsa', json: ticket.ai.picture }
  if (ticket.kind === 'design' && ticket.ai?.diagram) return { kind: 'design', json: ticket.ai.diagram }
  return null
}

/** VZ "four places" #4: replayed before the redo timer starts, then hidden. Free: it was paid for once. */
export function RedoReplay({ picture, title }: { picture: PictureJson; title: string }) {
  return (
    <section className="sr-panel redo-replay" aria-label="Replay before you start" data-testid="redo-replay">
      <h2 className="sr-panel-title">Replay before you start</h2>
      <p className="rung-note">Watch it once, then rebuild it from memory in your log.</p>
      <PicturePlayer picture={picture} title={title} />
    </section>
  )
}
