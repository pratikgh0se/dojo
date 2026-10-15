import { useEffect, useState } from 'react'
import { FRAME_KINDS, FRAME_LABEL_MAX, type KitZone } from '../../../rules/designCanvas'

export interface FramesListProps {
  frames: KitZone[]
  locked: boolean
  onLabel: (id: string, label: string) => void
  onKind: (id: string, kind: string) => void
  onRemove: (id: string) => void
}

/** One row per frame. A frame is drawn by the engine once it holds a node; empty frames live here until then. */
export function FramesList({ frames, locked, onLabel, onKind, onRemove }: FramesListProps) {
  if (frames.length === 0) return null
  return (
    <ul className="kit-frames" data-testid="kit-frames" aria-label="Frames">
      {frames.map(f => <FrameRow key={f.id} frame={f} locked={locked} onLabel={onLabel} onKind={onKind} onRemove={onRemove} />)}
    </ul>
  )
}

function FrameRow({ frame: f, locked, onLabel, onKind, onRemove }: { frame: KitZone } & Omit<FramesListProps, 'frames'>) {
  // The draft keeps what was typed (a trailing space survives the trimmed commit); it follows the stored
  // label only when that is a different name.
  const [draft, setDraft] = useState(f.label)
  useEffect(() => { setDraft(d => (d.trim() === f.label ? d : f.label)) }, [f.label])
  return (
    <li className="kit-frame-row" data-testid={`kit-frame-${f.id}`}>
      <input
        type="text" aria-label={`Frame name ${f.id}`} data-testid={`kit-frame-label-${f.id}`} maxLength={FRAME_LABEL_MAX} disabled={locked} value={draft}
        onChange={e => { setDraft(e.target.value); onLabel(f.id, e.target.value.trim()) }}
        onBlur={() => setDraft(f.label)}
      />
      <select aria-label={`Frame kind ${f.id}`} data-testid={`kit-frame-kind-${f.id}`} disabled={locked} value={f.kind} onChange={e => onKind(f.id, e.target.value)}>
        {FRAME_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
      </select>
      <span className="kit-frame-count">{f.nodes.length} {f.nodes.length === 1 ? 'block' : 'blocks'}</span>
      <button type="button" className="sr-btn sr-btn-control" data-testid={`kit-frame-remove-${f.id}`} aria-label={`Remove frame ${f.label}`} disabled={locked} onClick={() => onRemove(f.id)}>Remove</button>
    </li>
  )
}
