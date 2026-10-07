import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { useDb } from '../../app/providers'
import { moveArtifact } from '../../data/projectActions'
import { safeWrite } from '../../data/safeWrite'
import type { ArtifactStatus } from '../../data/types'
import { now } from '../../lib/clock'
import { pad2 } from '../../lib/dates'
import {
  boardColumns, isDone, latestMeasure, STATUS_LABEL, STATUS_ORDER, STATUS_SLUG, stepTarget, type ArtifactRecord,
} from '../../rules/artifacts'
import { measureText } from '../../rules/measures'
import { Button, useToast } from '../../ui/primitives'
import { REGION_IDS, Region } from './Region'

const allowDrop = (e: DragEvent<HTMLElement>) => e.preventDefault()

export function openButtonSelector(id: string): string {
  return `[data-artifact-id="${id}"] [data-testid="board-card-open"]`
}

/**
 * R4 (C-PROJECTS §2.4). Drag a card onto a column, or Shift+Arrow on its open button.
 * Forward moves pass the evidence gates; a block shows the first failing gate in role=alert.
 */
export function BuildBoard({ artifacts, onOpen, onAdd }: { artifacts: ArtifactRecord[]; onOpen: (id: string) => void; onAdd: () => void }) {
  const d = useDb()
  const toast = useToast()
  const [live, setLive] = useState('')
  const [gate, setGate] = useState<string | null>(null)
  const dragId = useRef<string | null>(null)
  const pendingFocus = useRef<{ id: string; status: ArtifactStatus } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const cols = boardColumns(artifacts)

  // A moved card remounts under another list and drops focus; put it back on its open button.
  useEffect(() => {
    const p = pendingFocus.current
    if (!p) return
    const el = rootRef.current?.querySelector<HTMLElement>(
      `[data-artifact-id="${p.id}"][data-status="${STATUS_SLUG[p.status]}"] [data-testid="board-card-open"]`,
    )
    if (!el) return
    el.focus()
    pendingFocus.current = null
  }, [artifacts])

  async function move(a: ArtifactRecord, to: ArtifactStatus, keepFocus: boolean) {
    if (to === a.status) return
    pendingFocus.current = keepFocus ? { id: a.id, status: to } : null
    const res = await safeWrite(() => moveArtifact(d, a.id, to, now()), m => toast(m, 'danger'))
    if (!res || !res.ok) {
      pendingFocus.current = null
      if (res && !res.ok) setGate(res.message)
      return
    }
    setGate(null)
    setLive(`${a.title} moved to ${STATUS_LABEL[to]}.`)
  }

  function drop(e: DragEvent<HTMLElement>, to: ArtifactStatus) {
    e.preventDefault()
    const id = dragId.current ?? e.dataTransfer?.getData('text/plain') ?? ''
    dragId.current = null
    const a = artifacts.find(x => x.id === id)
    if (a) void move(a, to, false)
  }

  function onKey(e: KeyboardEvent<HTMLButtonElement>, a: ArtifactRecord) {
    if (!e.shiftKey || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return
    e.preventDefault()
    const to = stepTarget(a.status, e.key === 'ArrowRight' ? 1 : -1)
    if (to) void move(a, to, true)
  }

  return (
    <Region
      id={REGION_IDS.build}
      title="Build board"
      testId="board-build"
      className="p-grid-full"
      actions={<Button variant="accent" data-testid="artifact-add" onClick={onAdd}>Add artifact</Button>}
    >
      {gate && <p className="p-gate" role="alert" data-testid="board-gate-alert">{gate}</p>}
      <p className="vh" role="status" aria-live="polite" data-testid="board-live">{live}</p>
      <div ref={rootRef} className="p-kanban p-kanban-5 sc">
        {STATUS_ORDER.map(s => (
          <div key={s} className="p-kcol">
            <h3 className="p-kcol-head">{STATUS_LABEL[s]} · {cols[s].length}</h3>
            <ul
              role="list"
              aria-label={STATUS_LABEL[s]}
              className="p-klist"
              data-testid={`board-col-${STATUS_SLUG[s]}`}
              onDragOver={allowDrop}
              onDrop={e => drop(e, s)}
            >
              {cols[s].map(a => {
                const m = latestMeasure(a)
                const done = isDone(a)
                return (
                  <li
                    key={a.id}
                    className={`p-card${done ? ' done' : ''}`}
                    data-testid="board-card"
                    data-artifact-id={a.id}
                    data-status={STATUS_SLUG[a.status]}
                    data-stage={pad2(a.stage ?? 0)}
                    draggable
                    onDragStart={e => {
                      dragId.current = a.id
                      e.dataTransfer?.setData('text/plain', a.id)
                    }}
                  >
                    <button type="button" className="p-card-open" data-testid="board-card-open" onClick={() => onOpen(a.id)} onKeyDown={e => onKey(e, a)}>
                      {a.title}
                    </button>
                    <span className="p-card-meta">
                      <span className="p-chip">ST {pad2(a.stage ?? 0)}</span>
                      {a.repo && <span className="p-repo" role="img" aria-label="repo" />}
                      {m && <span className="p-chip p-chip-measure" data-testid="measure-chip">{measureText(m)}</span>}
                      {typeof a.grade === 'number' && <span className="p-chip p-chip-grade" data-testid="grade-chip">{a.grade}/5</span>}
                      {done && <span className="p-done" data-testid="artifact-done-badge">DONE</span>}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </Region>
  )
}
