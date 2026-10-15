import { useRef, type KeyboardEvent, type PointerEvent as RPointerEvent, type RefObject } from 'react'
import { KIT_GRID, KIT_PAD } from '../../../content/diagramKit'
import { STICKY_TEXT_MAX, type CanvasNote } from '../../../rules/designCanvas'
import { usePointerEditing } from './pointer'

export interface NoteLayerProps {
  notes: CanvasNote[]
  selectedId: string | null
  locked: boolean
  canvasRef: RefObject<HTMLDivElement>
  onSelect: (id: string) => void
  onMove: (id: string, dx: number, dy: number) => void
  onEdit: (id: string, text: string) => void
  onKey: (e: KeyboardEvent<HTMLElement>, id: string) => void
}

/** Sticky notes: an HTML overlay with the same pointer and arrow-key code as nodes. 2D only (Iso lists them). */
export function NoteLayer({ notes, selectedId, locked, canvasRef, onSelect, onMove, onEdit, onKey }: NoteLayerProps) {
  const els = useRef(new Map<string, HTMLElement>())
  const pointer = usePointerEditing({
    locked, enabled: true, canvasRef,
    onMove, onLinkStart: () => {}, onLinkEnd: () => {},
    // a finished drag leaves the sticky selected AND focused, so arrow keys move it next (not the caret in its text)
    onSelect: id => { onSelect(id); els.current.get(id)?.focus() },
  })
  return (
    <>
      {notes.map(n => {
        const drag = pointer.dragOffset?.id === n.id ? pointer.dragOffset : null
        const handlers = pointer.nodeHandlers(n.id)
        return (
          <div
            key={n.id} ref={el => { if (el) els.current.set(n.id, el); else els.current.delete(n.id) }}
            className="kit-note" data-testid={`kit-note-${n.id}`} data-note-id={n.id} data-x={n.x} data-y={n.y}
            role="group" aria-label={`Note: ${n.text || 'empty'}`} tabIndex={0} aria-current={selectedId === n.id || undefined}
            style={{ position: 'absolute', left: KIT_PAD + n.x * KIT_GRID + (drag?.dx ?? 0), top: KIT_PAD + n.y * KIT_GRID + (drag?.dy ?? 0) }}
            {...handlers}
            // DESIGN-32: only the sticky's own 8 px top strip (and edges) drags; a press in the textarea places the caret
            // and must not set pointer capture (capture would retarget the click away from the textarea).
            onPointerDown={(e: RPointerEvent<HTMLElement>) => { if (e.target !== e.currentTarget) return; handlers.onPointerDown(e) }}
            onClick={() => { if (!pointer.consumeClick()) onSelect(n.id) }}
            onKeyDown={e => { if (e.target === e.currentTarget) onKey(e, n.id) }}
          >
            <textarea
              data-testid={`kit-note-text-${n.id}`} aria-label="Note text" rows={3} maxLength={STICKY_TEXT_MAX} disabled={locked} value={n.text}
              onFocus={() => onSelect(n.id)} onChange={e => onEdit(n.id, e.target.value)}
            />
          </div>
        )
      })}
    </>
  )
}
