import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { LINK_KINDS } from '../../../content/diagramKit'
import {
  addLink, addNode, countText, linkName, moveNode, nodeLabel, nodeName, removeLink, removeNode, renameNode, setLinkKind,
  type KitCanvas as Canvas,
} from '../../../rules/designCanvas'
import { exportDiagramPng } from '../../../lib/exportPng'
import { SrDiagram } from '../../../ui/engines/SrDiagram'
import { kitGeometry, linkAnchor, useDiagramEngine, useFontsReadyVersion } from './geometry'
import { Palette } from './Palette'
import { usePointerEditing } from './pointer'
import './kit.css'

type Selection = { type: 'node'; id: string } | { type: 'link'; from: string; to: string } | null
const STEP: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }

export interface KitProps {
  canvas: Canvas
  view: '2d' | 'iso'
  locked: boolean
  exportName: string
  onChange: (next: Canvas) => void
  onView: (view: '2d' | 'iso') => void
}

/** The block canvas: the frozen <sr-diagram> draws, a transparent overlay of buttons edits (C-DESIGN §2–§3). */
export function KitCanvas({ canvas, view, locked, exportName, onChange, onView }: KitProps) {
  const engine = useDiagramEngine()
  const fontsVersion = useFontsReadyVersion()
  const geo = useMemo(() => kitGeometry(canvas, engine), [canvas, engine, fontsVersion])
  const [sel, setSel] = useState<Selection>(null)
  const [linkFrom, setLinkFrom] = useState<string | null>(null)
  const [showJson, setShowJson] = useState(false)
  const [labelDraft, setLabelDraft] = useState('')
  const focusNext = useRef<string | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)

  const selNode = sel?.type === 'node' ? canvas.nodes.find(n => n.id === sel.id) ?? null : null
  const selLink = sel?.type === 'link' ? canvas.links.find(l => l.from === sel.from && l.to === sel.to) ?? null : null

  useEffect(() => setLabelDraft(selNode?.label ?? ''), [selNode?.id, selNode?.label])
  useEffect(() => {
    const id = focusNext.current
    if (!id) return
    focusNext.current = null
    stageRef.current?.querySelector<HTMLElement>(`[data-node-id="${id}"]`)?.focus()
  }, [canvas])
  useEffect(() => { if (locked) setLinkFrom(null) }, [locked])

  const selectNode = (id: string) => setSel({ type: 'node', id })

  const add = useCallback((kind: string, at?: { x: number; y: number }) => {
    if (locked) return
    const r = addNode(canvas, kind, at)
    focusNext.current = r.id
    setSel({ type: 'node', id: r.id })
    onChange(r.canvas)
  }, [canvas, locked, onChange])

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
      setLinkFrom(id)
    }
  }

  const onLinkKey = (e: KeyboardEvent<HTMLButtonElement>, from: string, to: string) => {
    if (locked || (e.key !== 'Delete' && e.key !== 'Backspace')) return
    e.preventDefault()
    setSel(null)
    onChange(removeLink(canvas, from, to))
  }

  const commitLabel = () => {
    if (!selNode || locked) return
    const next = renameNode(canvas, selNode.id, labelDraft)
    if (next !== canvas) onChange(next)
  }

  const status = linkFrom ? `Link from ${nodeLabel(canvas, linkFrom)}: pick a target` : ''

  return (
    <div className="kit" data-view={view}>
      <div className="kit-bar">
        <div role="group" aria-label="View" className="kit-views">
          <button type="button" className="sr-btn sr-btn-control" aria-pressed={view === '2d'} onClick={() => onView('2d')}>2D</button>
          <button type="button" className="sr-btn sr-btn-control" aria-pressed={view === 'iso'} onClick={() => onView('iso')}>Iso</button>
        </div>
        <span className="kit-count" data-testid="kit-count">{countText(canvas)}</span>
        <button type="button" className="sr-btn sr-btn-control" aria-pressed={showJson} onClick={() => setShowJson(v => !v)}>JSON</button>
        <button
          type="button" className="sr-btn sr-btn-control"
          onClick={() => void exportDiagramPng(stageRef.current?.querySelector('sr-diagram') ?? null, exportName)}
        >
          Export PNG
        </button>
      </div>
      {/* UAT cu-7 P3-2: the JSON opens right under the button that opened it, not below a 640 px canvas */}
      {showJson && <pre className="kit-json" data-testid="kit-json" tabIndex={0}>{JSON.stringify(canvas)}</pre>}
      <Palette
        locked={locked} onAdd={kind => add(kind)}
        onDrop={(kind, x, y) => { const cell = pointer.cellAt(x, y); if (cell) add(kind, cell) }}
      />
      <div className="kit-inspect">
        <label className="kit-field">
          <span aria-hidden="true">Label</span>
          <input
            type="text" aria-label="Node label" data-testid="kit-node-label" disabled={!selNode || locked} value={labelDraft}
            onChange={e => setLabelDraft(e.target.value)} onBlur={commitLabel}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commitLabel() }
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
      </div>
      <p className="kit-status" data-testid="kit-status" role="status">{status}</p>
      <div
        ref={canvasRef} className="kit-canvas sc" data-testid="kit-canvas" role="application" aria-label="Design canvas"
        aria-disabled={locked || undefined} data-locked={String(locked)} tabIndex={0}
      >
        <div
          ref={stageRef} className={`kit-stage kit-stage-${view}`}
          style={view === '2d' ? { width: geo.width, height: geo.height } : undefined}
          onClick={e => { if (e.target === e.currentTarget) { setSel(null); setLinkFrom(null) } }}
        >
          {canvas.nodes.length > 0
            ? <SrDiagram data={canvas} view={view} className="kit-diagram" label="Canvas drawing" />
            : <p className="kit-empty">Add a kind from the palette: click it, drag it here, or press Enter on it.</p>}
          <div className={`kit-overlay kit-overlay-${view}`}>
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
                    {view === 'iso' ? nodeName(n) : null}
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
    </div>
  )
}
