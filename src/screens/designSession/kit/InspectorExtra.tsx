import { KIT_KINDS } from '../../../content/diagramKit'
import {
  CUSTOM_KIND, CUSTOM_SUB_MAX, DEFAULT_GLYPH, frameOf, setFrame, setGlyph, setNodeLabel, setSchemaLink, setSub, type KitCanvas, type KitNode,
} from '../../../rules/designCanvas'
import type { DesignNotes } from '../../../rules/designDigest'

/** A custom box can be drawn as any kit kind except `table` (a table is a schema block, not a glyph). */
const GLYPHS = KIT_KINDS.filter(k => k !== 'table')

export interface InspectorExtraProps {
  canvas: KitCanvas
  notes: DesignNotes
  node: KitNode | null
  locked: boolean
  onChange: (next: KitCanvas) => void
}

/** Fields only some blocks have: a custom box's label, description and glyph; a table block's schema table. Every block has a Frame. */
export function InspectorExtra({ canvas, notes, node, locked, onChange }: InspectorExtraProps) {
  if (!node) return null
  const frame = (
    <label className="kit-field">
      <span aria-hidden="true">Frame</span>
      <select aria-label="Frame" data-testid="kit-frame-select" disabled={locked} value={frameOf(canvas, node.id)?.id ?? ''}
        onChange={e => onChange(setFrame(canvas, node.id, e.target.value || null))}>
        <option value="">None</option>
        {canvas.zones.map(z => <option key={z.id} value={z.id}>{z.label}</option>)}
      </select>
    </label>
  )
  if (node.kind === CUSTOM_KIND) {
    return (
      <div className="kit-inspect kit-inspect-extra" data-testid="kit-inspect-custom">
        <label className="kit-field">
          <span aria-hidden="true">Box name</span>
          <input type="text" aria-label="Box name" data-testid="kit-custom-label" maxLength={40} disabled={locked} value={node.label}
            onChange={e => onChange(setNodeLabel(canvas, node.id, e.target.value))} />
        </label>
        <label className="kit-field">
          <span aria-hidden="true">Description</span>
          <input type="text" aria-label="Box description" data-testid="kit-custom-sub" maxLength={CUSTOM_SUB_MAX} disabled={locked} value={node.sub ?? ''}
            onChange={e => onChange(setSub(canvas, node.id, e.target.value))} />
          <span className="kit-field-count" data-testid="kit-custom-sub-count" aria-hidden="true">{(node.sub ?? '').length} / {CUSTOM_SUB_MAX}</span>
        </label>
        <label className="kit-field">
          <span aria-hidden="true">Drawn as</span>
          <select aria-label="Box glyph" data-testid="kit-custom-glyph" disabled={locked} value={node.glyph ?? DEFAULT_GLYPH}
            onChange={e => onChange(setGlyph(canvas, node.id, e.target.value))}>
            {GLYPHS.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
        {frame}
      </div>
    )
  }
  if (node.kind === 'table') {
    return (
      <div className="kit-inspect kit-inspect-extra" data-testid="kit-inspect-table">
        <label className="kit-field">
          <span aria-hidden="true">Schema table</span>
          <select aria-label="Schema table" data-testid="kit-table-select" disabled={locked} value={node.schemaId ?? ''}
            onChange={e => onChange(setSchemaLink(canvas, node.id, e.target.value || null, notes))}>
            <option value="">None</option>
            {notes.schema.map(t => <option key={t.id} value={t.id}>{t.name || t.id}</option>)}
          </select>
        </label>
        {frame}
      </div>
    )
  }
  return <div className="kit-inspect kit-inspect-extra">{frame}</div>
}
