import { Link } from 'react-router-dom'
import { useShellActions } from '../app/shellActions'
import { DEST_LINE, GUIDE } from '../content/guide'
import { DESTINATIONS } from '../rules/nav'
import { Button } from '../ui/primitives'
import './guide.css'

/** "How Dojo works" (NAV-27 to NAV-31): nine sections, one line per rail destination, and the way to the shortcuts overlay. */
export function Guide() {
  const { openShortcuts } = useShellActions()
  return (
    <div className="gd">
      <h1 className="gd-title" data-testid="guide-title">How Dojo works</h1>
      {GUIDE.map(s => (
        <section key={s.id} className="sr-panel gd-sec" data-testid={`guide-section-${s.id}`}>
          <h2 className="gd-h">{s.title}</h2>
          {s.paragraphs.map(p => <p key={p} className="gd-p">{p}</p>)}
          {s.id === 'destinations' && (
            <ul className="gd-dests">
              {DESTINATIONS.map(d => (
                <li key={d.id} className="gd-dest" data-testid={`guide-dest-${d.id}`}>
                  <Link to={d.to}>{d.label}</Link> {DEST_LINE[d.id]}
                </li>
              ))}
            </ul>
          )}
          {s.prompts && (
            <div className="gd-prompts">
              <p className="gd-p">Prompts to copy:</p>
              {s.prompts.map(p => <pre key={p} className="gd-pre">{p}</pre>)}
            </div>
          )}
          {s.id === 'shortcuts' && <div><Button data-testid="guide-open-shortcuts" onClick={openShortcuts}>Show all shortcuts</Button></div>}
        </section>
      ))}
    </div>
  )
}
