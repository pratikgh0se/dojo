import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { LINK_KINDS } from '../../../content/diagramKit'
import {
  addCustom, addFrame, addLink, addNode, addSticky, addTableBlock, countText, CUSTOM_KIND, editSticky, groupNodes, linkName, moveNode, moveSticky, nodeLabel, nodeName, nodeView, removeLink, removeNode, removeSticky,
  removeFrame, renameFrame, renameNode, renameTableNode, setFrameKind, setLinkKind, setNodeLabel, syncTableNodes, toEngineJson, ungroupNode, type KitCanvas as Canvas,
} from '../../../rules/designCanvas'
import type { DesignNotes } from '../../../rules/designDigest'
import { emptyNotes } from '../../../rules/designNotes'
import { exportDiagramPng } from '../../../lib/exportPng'
import { isTypingTarget } from '../../../lib/keys'
import { SrDiagram } from '../../../ui/engines/SrDiagram'
import { canvasAction } from './canvasKeys'
import { FramesList } from './FramesList'
import { kitGeometry, linkAnchor, useDiagramEngine, useFontsReadyVersion } from './geometry'
import { InspectorExtra } from './InspectorExtra'
import { NoteLayer } from './NoteLayer'
import { Palette } from './Palette'
import { usePointerEditing } from './pointer'
import { ToolCounts, Tools } from './Tools'
import './kit.css'

type Selection = { type: 'node'; id: string } | { type: 'link'; from: string; to: string } | { type: 'note'; id: string } | null
const EMPTY_NOTES = emptyNotes()
const STEP: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }

export interface KitProps {
  canvas: Canvas
  view: '2d' | 'iso'
  locked: boolean
  exportName: string
  onChange: (next: Canvas) => void
  onView: (view: '2d' | 'iso') => void
  /** the design notes: schema tables feed the table blocks. Optional so the canvas still works alone. */
  notes?: DesignNotes
  onNotes?: (next: DesignNotes) => void
  onHelp?: () => void
}

/** The block canvas: the frozen <sr-diagram> draws, a transparent overlay of buttons edits (C-DESIGN §2–§3). */
export function KitCanvas({ canvas, view, locked, exportName, onChange, onView, notes = EMPTY_NOTES, onNotes, onHelp }: KitProps) {
  const engine = useDiagramEngine()
  const fontsVersion = useFontsReadyVersion()
  // F1: the engine draws what toEngineJson makes of the canvas and the schema, never the stored canvas.
  const engineData = useMemo(() => toEngineJson(canvas, notes), [canvas, notes])
  const geo = useMemo(() => kitGeometry(engineData, engine), [engineData, engine, fontsVersion])
  const [sel, setSel] = useState<Selection>(null)
  const [linkFrom, setLinkFrom] = useState<string | null>(null)
  const [showJson, setShowJson] = useState(false)
  const [labelDraft, setLabelDraft] = useState('')
  const focusNext = useRef<string | null>(null)
  const focusQuery = useRef<string | null>(null)
  const draftId = useRef<string | null>(null)
  const lastNotes = useRef(notes)
  const canvasRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)

  const selNode = sel?.type === 'node' ? canvas.nodes.find(n => n.id === sel.id) ?? null : null
  const selLink = sel?.type === 'link' ? canvas.links.find(l => l.from === sel.from && l.to === sel.to) ?? null : null

  // The draft keeps what was typed (a trailing space survives renameTableNode/renameNode trimming); it only
  // follows the stored label when that is a different name, or another block was selected.
  useEffect(() => {
    const label = selNode?.label ?? ''
    const sameNode = draftId.current === (selNode?.id ?? null)
    draftId.current = selNode?.id ?? null
    setLabelDraft(d => (sameNode && d.trim() === label.trim() ? d : label))
  }, [selNode?.id, selNode?.label])
  // After every notes change linked table blocks take the table's name, and an orphaned block is unlinked.
  // Not on mount and not when locked: opening a finished session never writes (DESIGN-78).
  useEffect(() => {
    if (lastNotes.current === notes) return
    lastNotes.current = notes
    if (locked) return
    const next = syncTableNodes(canvas, notes)
    if (next !== canvas) onChange(next)
  }, [notes, canvas, locked, onChange])
  useEffect(() => {
    const id = focusNext.current
    if (!id) return
    focusNext.current = null
    stageRef.current?.querySelector<HTMLElement>(`[data-node-id="${id}"]`)?.focus()
  }, [canvas])
  useEffect(() => {
    const q = focusQuery.current
    if (!q) return
    focusQuery.current = null
    document.querySelector<HTMLElement>(q)?.focus()
  }, [canvas])
  useEffect(() => { if (locked) setLinkFrom(null) }, [locked])

  const selectNode = (id: string) => setSel({ type: 'node', id })

  const add = useCallback((kind: string, at?: { x: number; y: number }) => {
    if (locked) return
    const r = addNode(canvas, kind, at, notes)
    focusNext.current = r.id
    setSel({ type: 'node', id: r.id })
    onChange(r.canvas)
  }, [canvas, notes, locked, onChange])

  const addCustomBox = useCallback(() => {
    if (locked) return
    const r = addCustom(canvas, undefined, notes)
    focusQuery.current = '[data-testid="kit-node-label"]'
    setSel({ type: 'node', id: r.id })
    onChange(r.canvas)
  }, [canvas, notes, locked, onChange])

  const addTableNode = useCallback(() => {
    if (locked || !onNotes) return
    const r = addTableBlock(canvas, notes)
    if (!r.nodeId) return
    focusQuery.current = '[data-testid="kit-node-label"]'
    setSel({ type: 'node', id: r.nodeId })
    onNotes(r.notes)
    onChange(r.canvas)
  }, [canvas, notes, locked, onChange, onNotes])

  const addStickyNote = useCallback(() => {
    if (locked) return
    const r = addSticky(canvas)
    if (!r.id) return
    focusQuery.current = `[data-testid="kit-note-text-${r.id}"]`
    setSel({ type: 'note', id: r.id })
    onChange(r.canvas)
  }, [canvas, locked, onChange])

  const onNoteKey = (e: KeyboardEvent<HTMLElement>, id: string) => {
    if (e.ctrlKey || e.metaKey || e.altKey || locked) return
    const step = STEP[e.key]
    if (step) { e.preventDefault(); setSel({ type: 'note', id }); onChange(moveSticky(canvas, id, step[0], step[1])); return }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); setSel(null); onChange(removeSticky(canvas, id)); canvasRef.current?.focus() }
  }

  const link = useCallback((from: string, to: string) => {
    setLinkFrom(null)
    if (locked) return
    const r = addLink(canvas, from, to)
    if (r.added) onChange(r.canvas)
  }, [canvas, locked, onChange])

  const pointer = usePointerEditing({
    locked, enabled: view === '2d', canvasRef,
    onMove: (id, dx, dy) => onChange(moveNode(canvas, id, dx, dy)),
    onSelect: selectNode,
    onLinkStart: setLinkFrom,
    onLinkEnd: (from, to) => (to ? link(from, to) : setLinkFrom(null)),
  })

  const onNodeClick = (id: string) => {
    if (pointer.consumeClick()) return
    if (linkFrom && !locked) {
      if (linkFrom !== id) link(linkFrom, id)
      else setLinkFrom(null)
      return
    }
    selectNode(id)
  }

  const removeAndRefocus = (id: string) => {
    const i = canvas.nodes.findIndex(n => n.id === id)
    const next = removeNode(canvas, id)
    const neighbour = next.nodes[Math.max(0, i - 1)] ?? null
    setSel(neighbour ? { type: 'node', id: neighbour.id } : null)
    if (neighbour) focusNext.current = neighbour.id
    else canvasRef.current?.focus()
    onChange(next)
  }

  const onNodeKey = (e: KeyboardEvent<HTMLButtonElement>, id: string) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (e.key === 'Escape') {
      if (linkFrom) { e.preventDefault(); setLinkFrom(null) }
      return
    }
    if (locked) return
    const step = STEP[e.key]
    if (step) {
      e.preventDefault()
      selectNode(id)
      onChange(moveNode(canvas, id, step[0], step[1]))
      return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      removeAndRefocus(id)
      return
    }
    if (e.key === 'l' || e.key === 'L') {
      e.preventDefault()
      selectNode(id)
      setLinkFrom(from => (from ? null : id)) // L toggles link mode (DESIGN-41)
    }
  }

  const onLinkKey = (e: KeyboardEvent<HTMLButtonElement>, from: string, to: string) => {
    if (locked || (e.key !== 'Delete' && e.key !== 'Backspace')) return
    e.preventDefault()
    setSel(null)
    onChange(removeLink(canvas, from, to))
  }

  /** Live: every keystroke commits (a tester's fill() fires no blur). A linked table block renames its schema table too. */
  const commitLabel = (text: string) => {
    if (!selNode || locked) return
    if (selNode.kind === 'table' && selNode.schemaId) {
      const r = renameTableNode(canvas, notes, selNode.id, text)
      if (r.notes !== notes) onNotes?.(r.notes)
      if (r.canvas !== canvas) onChange(r.canvas)
      return
    }
    const next = selNode.kind === CUSTOM_KIND ? setNodeLabel(canvas, selNode.id, text) : renameNode(canvas, selNode.id, text)
    if (next !== canvas) onChange(next)
  }

  const fieldsOf = (n: Canvas['nodes'][number]) => (n.kind === 'table' ? nodeView(n, notes).fields : [])

  const addFrameOnly = useCallback(() => {
    if (locked) return
    const r = addFrame(canvas)
    if (r.id) onChange(r.canvas)
  }, [canvas, locked, onChange])

  /** Canvas-focus keys (SHELL-05, DESIGN-39 to 41, 44). Typing in a field is never ours; the per-node handlers run first and preventDefault. */
  const onCanvasKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || isTypingTarget(e.target)) return
    if (e.key === 'Escape') {
      if (linkFrom) { e.preventDefault(); setLinkFrom(null) } // the first Esc leaves link mode ...
      else if (sel) { e.preventDefault(); setSel(null) } // ... the next one clears the selection (as a click on empty canvas does)
      return
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const action = canvasAction(e)
    if (action === 'help') { e.preventDefault(); onHelp?.(); return }
    if (locked) return
    if (action === 'add-note') { e.preventDefault(); addStickyNote(); return }
    if (action === 'add-custom') { e.preventDefault(); addCustomBox(); return }
    if (action === 'add-table') { e.preventDefault(); addTableNode(); return }
    if (action) {
      // G and Shift+G act on the selected block(s) only
      const picked = selNode ? [selNode.id] : []
      if (picked.length === 0) return
      e.preventDefault()
      if (action === 'group') {
        const r = groupNodes(canvas, picked)
        if (!r.id) return
        focusQuery.current = `[data-testid="kit-frame-label-${r.id}"]`
        onChange(r.canvas)
      } else {
        const next = picked.reduce(ungroupNode, canvas)
        if (next !== canvas) onChange(next)
      }
      return
    }
    // the same moves as on a focused node, applied to whatever is selected
    if (!sel) return
    const step = STEP[e.key]
    const del = e.key === 'Delete' || e.key === 'Backspace'
    if (sel.type === 'node' && selNode) {
      if (step) { e.preventDefault(); onChange(moveNode(canvas, selNode.id, step[0], step[1])) }
      else if (del) { e.preventDefault(); removeAndRefocus(selNode.id) }
      else if (e.key === 'l' || e.key === 'L') { e.preventDefault(); setLinkFrom(from => (from ? null : selNode.id)) } // toggles link mode (DESIGN-41)
    } else if (sel.type === 'note') {
      if (step) { e.preventDefault(); onChange(moveSticky(canvas, sel.id, step[0], step[1])) }
      else if (del) { e.preventDefault(); setSel(null); onChange(removeSticky(canvas, sel.id)) }
    } else if (sel.type === 'link' && selLink && del) {
      e.preventDefault(); setSel(null); onChange(removeLink(canvas, sel.from, sel.to))
    }
  }

  /** A click anywhere in the canvas puts focus on it so the selection keys work; empty space also clears the selection and link mode. */
  const onCanvasClick = (e: MouseEvent<HTMLDivElement>) => {
    const t = e.target
    if (!(t instanceof Element) || isTypingTarget(t)) return
    if (!t.closest('.kit-note')) canvasRef.current?.focus({ preventScroll: true })
    if (!t.closest('.kit-node, .kit-link, .kit-note, .kit-port')) { setSel(null); setLinkFrom(null) }
  }

  const status = linkFrom ? `Link from ${nodeLabel(canvas, linkFrom)}: pick a target` : ''

  return (
    <div className="kit" data-view={view}>
      {/* One row above the canvas (mockup 7b): the family buttons, a divider, the four tools. A family's tiles open in a flyout over the canvas; everything that edits the selection or the view sits in the footer below. */}
      <Palette
        locked={locked} onAdd={kind => add(kind)}
        onDrop={(kind, x, y) => { const cell = pointer.cellAt(x, y); if (!cell) return false; add(kind, cell); return true }}
        tools={<Tools locked={locked} notes={canvas.notes.length} frames={canvas.zones.length} tables={notes.schema.length} onCustom={addCustomBox} onNote={addStickyNote} onTable={onNotes ? addTableNode : undefined} onFrame={addFrameOnly} />}
      />
      <div
        ref={canvasRef} className="kit-canvas sc" data-testid="kit-canvas" role="application" aria-label="Design canvas"
        aria-disabled={locked || undefined} data-locked={String(locked)} tabIndex={0}
        onKeyDown={onCanvasKey} onClick={onCanvasClick} data-no-global-keys="" data-focus-zone="canvas"
      >
        <div
          ref={stageRef} className={`kit-stage kit-stage-${view}`}
          style={view === '2d' ? { width: geo.width, height: geo.height } : undefined}
        >
          {canvas.nodes.length > 0
            ? <SrDiagram data={engineData} view={view} className="kit-diagram" label="Canvas drawing" />
            : <p className="kit-empty">Add a kind from the palette: click it, drag it here, or press Enter on it.</p>}
          <div className={`kit-overlay kit-overlay-${view}`}>
            {view === '2d' && (
              <NoteLayer
                notes={canvas.notes} selectedId={sel?.type === 'note' ? sel.id : null} locked={locked} canvasRef={canvasRef}
                onSelect={id => setSel({ type: 'note', id })} onMove={(id, dx, dy) => onChange(moveSticky(canvas, id, dx, dy))}
                onEdit={(id, text) => onChange(editSticky(canvas, id, text))} onKey={onNoteKey}
              />
            )}
            {canvas.nodes.map(n => {
              const b = geo.boxes.get(n.id)
              return (
                <Fragment key={n.id}>
                  <button
                    type="button" className="kit-node" data-testid={`kit-node-${n.id}`} data-node-id={n.id}
                    data-kind={n.kind} data-x={n.x} data-y={n.y} aria-label={nodeName(n)}
                    aria-pressed={sel?.type === 'node' && sel.id === n.id}
                    style={view === '2d' && b ? { left: b.left + (pointer.dragOffset?.id === n.id ? pointer.dragOffset.dx : 0), top: b.top + (pointer.dragOffset?.id === n.id ? pointer.dragOffset.dy : 0), width: b.w, height: b.h } : undefined}
                    {...pointer.nodeHandlers(n.id)}
                    onClick={() => onNodeClick(n.id)} onKeyDown={e => onNodeKey(e, n.id)}
                  >
                    {/* the label is the block's text in both views (DESIGN-28 reads it there); the drawing carries it visually in 2D */}
                    {view === 'iso' ? nodeName(n) : <span className="vh">{nodeName(n)}</span>}
                    {fieldsOf(n).length > 0 && (
                      <ul className="vh" data-testid={`kit-node-fields-${n.id}`}>
                        {fieldsOf(n).map((f, i) => <li key={i}>{f}</li>)}
                      </ul>
                    )}
                  </button>
                  {view === '2d' && b && (
                    <span
                      className="kit-port" data-testid={`kit-port-${n.id}`} data-port-id={n.id} aria-hidden="true"
                      style={{ left: b.left + b.w - 6, top: b.top + Math.round(b.h / 2) - 6 }}
                      onPointerDown={e => pointer.onPortPointerDown(e, n.id)}
                    />
                  )}
                </Fragment>
              )
            })}
            {canvas.links.map(l => {
              const a = linkAnchor(geo, l)
              const on = sel?.type === 'link' && sel.from === l.from && sel.to === l.to
              return (
                <button
                  key={`${l.from}>${l.to}`} type="button" className="kit-link" data-testid={`kit-link-${l.from}-${l.to}`}
                  data-kind={l.kind} aria-label={linkName(canvas, l)} aria-pressed={on}
                  style={view === '2d' && a ? { left: a.x - 8, top: a.y - 8 } : undefined}
                  onClick={() => setSel({ type: 'link', from: l.from, to: l.to })} onKeyDown={e => onLinkKey(e, l.from, l.to)}
                >
                  {view === 'iso' ? linkName(canvas, l) : null}
                </button>
              )
            })}
          </div>
        </div>
      </div>
      {/* the JSON opens just above the footer button that opened it (UAT cu-7 P3-2), the canvas giving up the room */}
      {showJson && <pre className="kit-json" data-testid="kit-json" tabIndex={0}>{JSON.stringify(canvas)}</pre>}
      <div className="kit-foot">
        <div className="kit-bar">
          <div role="group" aria-label="View" className="kit-views">
            <button type="button" className="sr-btn sr-btn-control" data-testid="kit-view-2d" aria-pressed={view === '2d'} onClick={() => onView('2d')}>2D</button>
            <button type="button" className="sr-btn sr-btn-control" data-testid="kit-view-iso" aria-pressed={view === 'iso'} onClick={() => onView('iso')}>Iso</button>
          </div>
          <span className="kit-count" data-testid="kit-count">{countText(canvas)}</span>
          <ToolCounts notes={canvas.notes.length} frames={canvas.zones.length} />
          <button type="button" className="sr-btn sr-btn-control kit-bar-end" aria-pressed={showJson} onClick={() => setShowJson(v => !v)}>JSON</button>
          <button
            type="button" className="sr-btn sr-btn-control"
            onClick={() => void exportDiagramPng(stageRef.current?.querySelector('sr-diagram') ?? null, exportName)}
          >
            Export PNG
          </button>
        </div>
        <div className="kit-inspect">
          <label className="kit-field">
            <span aria-hidden="true">Label</span>
            <input
              type="text" aria-label="Node label" data-testid="kit-node-label" disabled={!selNode || locked} value={labelDraft}
              onChange={e => { setLabelDraft(e.target.value); commitLabel(e.target.value) }}
              onBlur={() => setLabelDraft(selNode?.label ?? '')}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); setLabelDraft(selNode?.label ?? '') }
                if (e.key === 'Escape') setLabelDraft(selNode?.label ?? '')
              }}
            />
          </label>
          <label className="kit-field">
            <span aria-hidden="true">Link</span>
            <select
              aria-label="Link kind" data-testid="kit-link-kind" disabled={!selLink || locked} value={selLink?.kind ?? 'sync'}
              onChange={e => { if (selLink) onChange(setLinkKind(canvas, selLink.from, selLink.to, e.target.value)) }}
            >
              {LINK_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </label>
          <p className="kit-status" data-testid="kit-status" role="status">{status}</p>
        </div>
        <InspectorExtra canvas={canvas} notes={notes} node={selNode} locked={locked} onChange={onChange} />
        <FramesList
          frames={canvas.zones} locked={locked}
          onLabel={(id, l) => onChange(renameFrame(canvas, id, l))} onKind={(id, k) => onChange(setFrameKind(canvas, id, k))} onRemove={id => onChange(removeFrame(canvas, id))}
        />
      </div>
      {view === 'iso' && (
        <div className="kit-notes-list" data-testid="kit-notes-list">
          <p>{canvas.notes.length} {canvas.notes.length === 1 ? 'note' : 'notes'}</p>
          <ul>{canvas.notes.map(n => <li key={n.id}>{n.text || '(empty)'}</li>)}</ul>
        </div>
      )}
    </div>
  )
}
