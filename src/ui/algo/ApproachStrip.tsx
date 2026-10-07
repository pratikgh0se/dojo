import { useId, useRef, useState } from 'react'
import { approachesFor, chipName, type Approach } from '../../content/approaches'
import { Button } from '../primitives'
import { AlgoPlayer } from './AlgoPlayer'
import { TwoUp } from './TwoUp'

// 'two' carries library walkthrough keys (not approach ids): once open, the right pane is swappable via
// TwoUp's own "Compare with" select (onRight), same as AtlasDetail's two-up.
type Open = { kind: 'one'; id: string } | { kind: 'two'; left: string; right: string } | null

function Chip({ a, pressed, disabled, onClick }: { a: Approach; pressed: boolean; disabled?: boolean; onClick: (el: HTMLButtonElement) => void }) {
  return (
    <button
      type="button"
      className={`approach-chip${a.best ? ' best' : ''}`}
      aria-label={chipName(a)}
      aria-pressed={pressed}
      disabled={disabled}
      data-testid="dsa-approach-chip"
      data-library-key={a.libraryKey}
      onClick={e => onClick(e.currentTarget)}
    >
      <span className="ac-name">{a.name}</span>
      <span className="ac-cx"><Complexity text={a.complexity} /></span>
      {a.best && <span className="ac-star" aria-hidden="true">★</span>}
    </button>
  )
}

/**
 * TRACKING §3 "Approaches strip" on Do (labs contract §7.1, §7.2, D-14): 2–4 ways brute → best, the best
 * starred but not opened. A chip with a library walkthrough opens it here (free in L); Pick two opens the
 * two chosen ones in Two-up, first pick on the left.
 */
export function ApproachStrip({ problemId }: { problemId: string }) {
  const list = approachesFor(problemId)
  const [open, setOpen] = useState<Open>(null)
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [note, setNote] = useState<string | null>(null)
  const opener = useRef<HTMLButtonElement | null>(null)
  const byId = (id: string) => list.find(a => a.id === id)!

  function click(a: Approach, el: HTMLButtonElement) {
    setNote(null)
    if (picking) {
      const next = picked.includes(a.id) ? picked.filter(x => x !== a.id) : [...picked, a.id]
      if (next.length < 2) return setPicked(next)
      opener.current = el
      setOpen({ kind: 'two', left: byId(next[0]).libraryKey!, right: byId(next[1]).libraryKey! })
      setPicked([])
      setPicking(false)
      return
    }
    if (!a.libraryKey) {
      // UAT cu-4 P3-1: the answer replaces what was open, so no earlier player (and no pressed chip) stays under the note
      setOpen(null)
      setNote('No library picture for this approach yet.')
      return
    }
    opener.current = el
    setOpen({ kind: 'one', id: a.id })
  }
  const close = () => {
    setOpen(null)
    setNote(null)
    opener.current?.focus()
  }

  return (
    <section className="sr-panel approaches" aria-label="Approaches" data-testid="dsa-approaches">
      <h2 className="sr-panel-title">Approaches</h2>
      {list.length === 0 ? (
        <p className="hint">No approaches listed yet.</p>
      ) : (
        <>
          <div className="approach-chips">
            {list.map(a => (
              <Chip
                key={a.id}
                a={a}
                pressed={picking ? picked.includes(a.id) : open?.kind === 'one' && open.id === a.id}
                disabled={picking && !a.libraryKey}
                onClick={el => click(a, el)}
              />
            ))}
            <Button
              aria-pressed={picking}
              onClick={() => {
                setPicking(!picking)
                setPicked([])
                setNote(null)
              }}
            >
              Pick two
            </Button>
          </div>
          {note && <p role="status" className="hint">{note}</p>}
          {open?.kind === 'one' && <AlgoPlayer key={open.id} walkKey={byId(open.id).libraryKey} onClose={close} />}
          {open?.kind === 'two' && (
            <TwoUp
              key={`${open.left}-${open.right}`}
              left={open.left}
              right={open.right}
              onRight={r => setOpen({ ...open, right: r })}
              onClose={close}
            />
          )}
        </>
      )}
    </section>
  )
}

/**
 * "Which approach did you use?" after Solved (labs contract §7.3, D-16): the chips' names plus Other;
 * changeable. Answering doesn't itself leave the screen (I4): "Back to Board" is the only way out while
 * this question is open, so it's not stranded here — openRung and the Space/timer shortcut are disabled
 * on the Do screen for as long as this is showing.
 */
export function ApproachQuestion({
  problemId, chosen, onChoose, onBack,
}: { problemId: string; chosen: string | null; onChoose: (id: string) => void; onBack: () => void }) {
  const list = approachesFor(problemId)
  const id = useId()
  return (
    <div className="approach-used" role="group" aria-labelledby={id} data-testid="dsa-approach-used">
      <p className="hint" id={id}>Which approach did you use?</p>
      <div className="approach-chips">
        {/* UAT J4: the chosen answer is filled (accent); the complexity is written as maths, not upper-cased */}
        {[...list.map(a => ({ id: a.id, label: chipName(a), a })), { id: 'other', label: 'Other', a: null }].map(o => (
          <Button
            key={o.id} variant={chosen === o.id ? 'accent' : 'control'} className="approach-answer" aria-pressed={chosen === o.id} aria-label={o.label}
            onClick={() => onChoose(o.id)}
          >
            {o.a ? (
              <span>{o.a.name} · <span className="aa-cx"><Complexity text={o.a.complexity} /></span>{o.a.best ? ' · best' : ''}</span>
            ) : o.label}
          </Button>
        ))}
      </div>
      <Button variant="quiet" onClick={onBack}>Back to Board</Button>
    </div>
  )
}

/**
 * "O(2^n)" with the exponent drawn as a superscript (a caret reads as "∧" in the upper-case button font: UAT J4).
 * The caret and brackets stay in the text, visually hidden, so the text is still exactly "O(2^n)".
 */
export function Complexity({ text }: { text: string }) {
  const parts = text.split(/\^(\([^)]*\)|[A-Za-z0-9]+)/)
  return (
    <>
      {parts.map((p, i) => {
        if (i % 2 === 0) return p
        const paren = p.startsWith('(')
        return (
          <span key={i}>
            <span className="vh">{paren ? '^(' : '^'}</span>
            <sup>{paren ? p.slice(1, -1) : p}</sup>
            {paren && <span className="vh">)</span>}
          </span>
        )
      })}
    </>
  )
}
