import { useState } from 'react'
import type { DesignSession } from '../../data/types'
import type { DesignMode } from '../../rules/designDigest'
import { modeLabel } from '../../rules/designMode'
import type { PlanDesignRef } from '../../rules/designs'
import { RUBRIC_BREAKDOWN, SESSION_MINUTES } from '../../rules/designSession'
import { Glyph, type GlyphName } from '../../ui/Glyph'
import { ExtLink } from '../../ui/Prose'
import { Button } from '../../ui/primitives'
import { DeepDiveList } from './DeepDiveList'

type Choice = 'ai-partner' | 'human-partner'
const CARDS: { id: Choice; testId: string; title: string; sub: string; body: string; points: [GlyphName, string][] }[] = [
  { id: 'ai-partner', testId: 'design-mode-ai-partner', title: 'Solo · AI partner', sub: 'Just you and the screen',
    body: 'An AI thinking coach asks one question at a time while you draw and write. It never gives answers. It grades your chat, notes and diagram together.',
    points: [['chat', 'Asks questions while you draw and write'], ['question', 'Pushes on trade-offs you skipped'], ['check', 'Grades your notes and diagram together']] },
  { id: 'human-partner', testId: 'design-mode-with-someone', title: 'With someone', sub: 'A friend plays that role',
    body: 'A friend plays the person across the table, with a partner card in a second window. No AI speaks.',
    points: [['doc', 'Partner card: prompt, follow-ups and a digest of your work'], ['metric', 'A scoring sheet the friend fills in'], ['lock', 'No AI anywhere in the session']] },
]

/** The ticket text of a design is its deep dives as bullet lines; when it is exactly that, the numbered Deep dives list already says it. */
function isDiveBrief(text: string, dives: string[]): boolean {
  const lines = text.split('\n').map(l => l.replace(/^\s*•\s*/, '').trim()).filter(Boolean)
  return lines.length === dives.length && lines.every((l, i) => l === dives[i].trim())
}

/** Setup (DESIGN-01 to 05): the ticket's prompt, who plays the person across the table, and one accent Start. */
export function SetupPanel({
  item, text, redo, onStart, live,
}: { item: PlanDesignRef; text?: string; redo: DesignSession | null; onStart: (mode: DesignMode) => void; live?: { onResume: () => void; onDiscard: () => void } }) {
  const [choice, setChoice] = useState<Choice>('ai-partner')
  const [skip, setSkip] = useState(false)
  const dupe = !!text && isDiveBrief(text, item.deepDives)
  const mode: DesignMode = choice === 'human-partner' ? 'human-partner' : skip ? 'solo' : 'ai-partner'
  return (
    <section className="sr-panel ds-setup" data-testid="session-setup" aria-label="Setup">
      <div className="ds-setup-main">
        {redo && <p className="ds-redo">Redesign pass · previous rubric {redo.rubric}</p>}
        <div data-testid="session-prompt" data-content="plan" className="ds-prompt">
          <h2 className="sr-panel-title">{item.title}</h2>
          {/* The brief is shown once. A text that is only the deep dives as bullets stays in the page for readers of the data (hidden from sight and from assistive tech) and the numbered list below carries it. */}
          {text && (dupe
            ? <p className="vh" aria-hidden="true" data-content="plan">{text}</p>
            : <p className="ds-brief" data-content="plan">{text}</p>)}
          <h3 className="ds-sub">Deep dives</h3>
          <DeepDiveList dives={item.deepDives} />
        </div>
        {item.refs.length > 0 && <p className="ds-refs" data-content="plan">{item.refs.map(r => <ExtLink key={r.url} link={r} />)}</p>}
        <h3 className="ds-sub">Pick your partner</h3>
        <div role="radiogroup" aria-label="Partner" className="ds-modes">
          {CARDS.map(c => (
            <button
              key={c.id} type="button" role="radio" className="ds-modecard" data-testid={c.testId} aria-checked={choice === c.id}
              onClick={() => { setChoice(c.id); if (c.id !== 'ai-partner') setSkip(false) }}
            >
              <span className="ds-mc-head">
                <span className="sr-tile ds-mc-tile" data-arcane={c.id === 'ai-partner' ? 'true' : undefined} aria-hidden="true">
                  {c.id === 'ai-partner' ? <b>AI</b> : <Glyph name="user" size={3} />}
                </span>
                <span className="ds-mc-titles"><strong>{c.title}</strong><span className="ds-mc-sub">{c.sub}</span></span>
                <span className="ds-mc-mark" aria-hidden="true" />
              </span>
              <span>{c.body}</span>
              <span className="ds-ml">{c.points.map(([g, pt]) => <span key={pt} className="ds-ml-i"><Glyph name={g} size={2} />{pt}</span>)}</span>
            </button>
          ))}
        </div>
        <label className="sr-choice">
          <input type="checkbox" data-testid="design-mode-skip-ai" checked={choice === 'ai-partner' && skip} disabled={choice !== 'ai-partner'} onChange={e => setSkip(e.target.checked)} />
          Skip the AI partner
        </label>
      </div>
      <div className="ds-setup-side">
        <h3 className="ds-sub">Your session</h3>
        <dl className="ds-dl" aria-label="Your session" data-testid="session-setup-summary">
          <dt>Partner</dt><dd>{modeLabel(mode)}</dd>
          <dt>Length</dt><dd>{SESSION_MINUTES} min</dd>
          <dt>Tools</dt><dd>Canvas, notes, timer</dd>
          <dt>Graded on</dt>
          <dd><span className="ds-graded">{RUBRIC_BREAKDOWN.split(' · ').map(r => <span key={r} className="ds-graded-i">{r}</span>)}</span></dd>
        </dl>
        {live ? (
          // A session is already running on this design (DESIGN-81): Start would do nothing, so Resume or Discard stands in its place.
          // Discard first, the accent last: nothing focusable follows the accent in this group (GLOBAL-03).
          <div className="ds-live" data-testid="session-live-note">
            <p className="ds-hint">A session is running on this design.</p>
            <div className="ds-actions">
              <Button variant="quiet" data-testid="session-live-discard" onClick={live.onDiscard}>Discard session</Button>
              <Button variant="accent" data-testid="session-live-resume" data-accent="primary" onClick={live.onResume}>RESUME · DESIGN</Button>
            </div>
          </div>
        ) : (
          <>
            <p className="ds-hint">The timer starts when you press Start. Closing early still grades what you have.</p>
            <div className="ds-actions">
              <Button variant="accent" data-testid="session-start" data-accent="primary" onClick={() => onStart(mode)}>START · DESIGN</Button>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
