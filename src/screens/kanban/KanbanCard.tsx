import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { Ticket } from '../../data/types'
import { altStep, cardMenuTargets, COLUMN_NAME, NOTE_MAX, type KColumn, type SetStatusOrDone } from '../../rules/kanban'
import { KIND_GLYPH, LANE_LABEL, minutesLabel, tagLane } from '../../rules/ticketMeta'
import { Glyph } from '../../ui/Glyph'
import { Button } from '../../ui/primitives'

export interface CardHandlers {
  onPointerDown: (e: ReactPointerEvent, id: string, title: string) => void
  suppressClick: () => boolean
  /** a move by key, menu or drop; `closeEditor` is true when it starts from the open reason editor */
  onMove: (t: Ticket, to: KColumn) => void
  onEditNote: (t: Ticket) => void
  onSaveNote: (t: Ticket, text: string) => void
  onSkipNote: (t: Ticket) => void
  onMenu: (id: string | null) => void
}

const NOTE_LABEL = { blocked: 'Why is it blocked?', help: 'What do you need help with?' } as const

/** BOARD-18, BOARD-19: the one-line reason; the status was written before this opened, so Skip and Esc write nothing. */
function NoteEditor({ t, prefill, onSave, onSkip }: { t: Ticket; prefill: string; onSave: (text: string) => void; onSkip: () => void }) {
  const [text, setText] = useState(prefill)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  const submit = (e: FormEvent) => { e.preventDefault(); onSave(text) }
  return (
    <form className="kb-editor" data-nodrag="true" onSubmit={submit}>
      <input
        ref={ref} type="text" className="kb-note-input" data-testid={`kanban-note-input-${t.id}`} maxLength={NOTE_MAX} value={text}
        aria-label={NOTE_LABEL[t.status === 'help' ? 'help' : 'blocked']} autoComplete="off"
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onSkip() } }}
      />
      <div className="kb-editor-row">
        <Button type="submit" data-testid={`kanban-note-save-${t.id}`}>Save</Button>
        <Button variant="quiet" data-testid={`kanban-note-skip-${t.id}`} onClick={onSkip}>Skip</Button>
      </div>
    </form>
  )
}

/** BOARD-35, BOARD-36: "Move to ...", and "Edit reason" on a blocked or need-help card. Fixed-positioned, so no column clips it. */
function CardMenu({ t, column, open, h }: { t: Ticket; column: KColumn; open: boolean; h: CardHandlers }) {
  const btn = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const targets = cardMenuTargets(column, t.kind)
  const parked = t.status === 'blocked' || t.status === 'help'

  // fixed-positioned beside its button: placed when it opens and again whenever the page or the board scrolls or resizes
  useEffect(() => {
    if (!open) { setPos(null); return }
    const place = () => {
      const b = btn.current?.getBoundingClientRect()
      if (!b) return
      const w = 220
      const need = (targets.length + (parked ? 1 : 0)) * 44 + 8
      const top = b.bottom + 4 + need > window.innerHeight ? Math.max(8, b.top - 4 - need) : b.bottom + 4
      const left = Math.max(8, Math.min(window.innerWidth - w - 8, b.right - w))
      setPos(p => (p && p.top === top && p.left === left ? p : { top, left }))
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place) }
  }, [open, targets.length, parked])
  useEffect(() => {
    if (!pos) return
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  }, [pos])
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => { if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) h.onMenu(null) }
    document.addEventListener('pointerdown', down)
    return () => document.removeEventListener('pointerdown', down)
  }, [open, h])

  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    const i = items.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); h.onMenu(null); btn.current?.focus() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus() }
    else if (e.key === 'Tab') h.onMenu(null)
  }
  const choose = (to: SetStatusOrDone) => { h.onMenu(null); h.onMove(t, to) }
  return (
    <>
      <button
        ref={btn} type="button" className="kb-menu-btn" data-testid={`kanban-card-menu-${t.id}`} data-nodrag="true" aria-label={`Move ${t.title}`}
        aria-haspopup="menu" aria-expanded={open} onClick={() => h.onMenu(open ? null : t.id)}
      >
        <Glyph name="moreV" size={2} />
      </button>
      {open && (
        <div
          ref={menu} role="menu" className="kb-menu" data-testid={`kanban-menu-${t.id}`} data-nodrag="true" aria-label={`Move ${t.title}`}
          style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden' }} onKeyDown={keys}
        >
          {targets.map(c => (
            <button key={c} type="button" role="menuitem" className="kb-menu-item" data-testid={`kanban-move-${t.id}-${c}`} onClick={() => choose(c)}>
              Move to {COLUMN_NAME[c]}
            </button>
          ))}
          {parked && (
            <button type="button" role="menuitem" className="kb-menu-item" data-testid={`kanban-edit-note-${t.id}`} onClick={() => { h.onMenu(null); h.onEditNote(t) }}>
              {t.blockedNote ? 'Edit reason' : 'Add reason'}
            </button>
          )}
        </div>
      )}
    </>
  )
}

/** One card (BOARD-15): the drag source, focusable, with its menu; a Done card has none. */
export function KanbanCard({ t, column, readOnly, dragging, editing, menuOpen, h }: {
  t: Ticket; column: KColumn; readOnly: boolean; dragging: boolean; editing: { prefill: string } | null; menuOpen: boolean; h: CardHandlers
}) {
  const navigate = useNavigate()
  const lane = tagLane(t)
  const done = column === 'done'
  const parked = t.status === 'blocked' || t.status === 'help'
  const note = parked ? t.blockedNote?.trim() : undefined

  const key = (e: KeyboardEvent<HTMLLIElement>) => {
    if (e.target instanceof Element && e.target.closest('[role="menu"]')) return
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key.startsWith('Arrow')) {
      e.preventDefault() // Alt+Up and Alt+Down: the Board has no reorder, nothing moves (BOARD-34)
      if (readOnly || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
      const to = altStep(column, e.key === 'ArrowLeft' ? -1 : 1)
      if (to) h.onMove(t, to)
      return
    }
    if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); navigate(`/do/${t.id}`) }
  }

  return (
    <li
      className="kb-card" data-testid={`kanban-card-${t.id}`} data-ticket-id={t.id} data-lane={lane} data-kind={t.kind} data-status={t.status} data-column={column}
      data-dragging={dragging ? 'true' : undefined} tabIndex={0} aria-label={`${t.title}, ${LANE_LABEL[lane]}, ${minutesLabel(t.estMin)}`}
      onPointerDown={e => h.onPointerDown(e, t.id, t.title)}
      onKeyDown={key}
      onContextMenu={e => { if ((e.nativeEvent as PointerEvent).pointerType === 'touch') e.preventDefault() }}
      // only a pointer click is the one that follows a release; the click Enter sends to the reason editor's Save button (detail 0) is never swallowed
      onClickCapture={e => { if (e.detail !== 0 && h.suppressClick()) { e.preventDefault(); e.stopPropagation() } }}
      onClick={e => {
        if (e.target instanceof Element && e.target.closest('a, button, input, form, [role="menu"]')) return
        navigate(`/do/${t.id}`)
      }}
    >
      <div className="kb-top">
        <Link to={`/do/${t.id}`} className="kb-title" data-testid={`kanban-open-${t.id}`} data-content="plan" draggable={false}>{t.title}</Link>
        {!done && !readOnly && <CardMenu t={t} column={column} open={menuOpen} h={h} />}
      </div>
      <div className="kb-meta">
        <span className="kb-kind" data-testid="kanban-card-kind" data-kind={t.kind}><Glyph name={KIND_GLYPH[t.kind]} size={2} /></span>
        <span className="kb-lane" data-testid="kanban-card-lane" data-lane={lane}>{LANE_LABEL[lane]}</span>
        <span className="kb-est" data-testid="kanban-card-est">{minutesLabel(t.estMin)}</span>
      </div>
      {note && !editing && <p className="kb-note" data-testid="kanban-card-note" data-content="learner">{note}</p>}
      {editing && parked && !readOnly && <NoteEditor t={t} prefill={editing.prefill} onSave={text => h.onSaveNote(t, text)} onSkip={() => h.onSkipNote(t)} />}
    </li>
  )
}
