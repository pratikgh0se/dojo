import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { bankAreaOf } from '../rules/bankQuestions'
import { DsaPanel } from './banks/DsaPanel'
import { QuestionBank } from './banks/QuestionBank'
import './banks.css'

/** BANK-01: the three areas of /banks, in order. `?area=` selects one; no parameter is DSA. */
const AREAS = [
  { id: 'dsa', label: 'DSA' },
  { id: 'design', label: 'Design' },
  { id: 'ai', label: 'AI' },
] as const
type AreaId = (typeof AREAS)[number]['id']

export function Banks() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('area')
  const urlArea: AreaId = raw === 'design' || raw === 'ai' ? (bankAreaOf(raw) as AreaId) : 'dsa'
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  // The router applies an address change as a low-priority transition, so for a few frames after a click the old tab's panel is still
  // on screen (BANK-25: the Design node list under a selected AI tab). The tab the user chose shows at once; the address catches up.
  const [chosen, setChosen] = useState<AreaId | null>(null)
  useEffect(() => setChosen(null), [urlArea])
  const area: AreaId = chosen ?? urlArea

  // A tab change pushes a history entry (Back restores the previous tab) and drops every other parameter: each area keeps its own filters.
  const select = (id: AreaId) => {
    if (id !== area) setChosen(id)
    setParams(new URLSearchParams({ area: id }))
  }
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const cur = AREAS.findIndex(a => a.id === area)
    let next = -1
    if (e.key === 'ArrowRight') next = (cur + 1) % AREAS.length
    else if (e.key === 'ArrowLeft') next = (cur - 1 + AREAS.length) % AREAS.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = AREAS.length - 1
    if (next < 0) return
    e.preventDefault()
    refs.current[next]?.focus()
    select(AREAS[next].id)
  }

  return (
    <div className="content-screen banks-shell">
      <h1 className="screen-title banks-title">Banks</h1>
      <div role="tablist" aria-label="Question banks" className="banks-areas" data-testid="banks-areas" onKeyDown={onKey}>
        {AREAS.map((a, i) => {
          const sel = a.id === area
          return (
            <button
              key={a.id} ref={el => { refs.current[i] = el }} type="button" role="tab" id={`banks-area-tab-${a.id}`}
              data-testid={`banks-area-${a.id}`} aria-selected={sel} aria-controls="banks-area-panel" tabIndex={sel ? 0 : -1}
              className={`banks-tab${sel ? ' sel' : ''}`} onClick={() => select(a.id)}
            >
              {a.label}
            </button>
          )
        })}
      </div>
      <div role="group" id="banks-area-panel" aria-labelledby={`banks-area-tab-${area}`} className="banks-area-panel">
        {area === 'dsa' ? <DsaPanel /> : <QuestionBank area={area} />}
      </div>
    </div>
  )
}
