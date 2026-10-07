import { useEffect, useState } from 'react'
import { KIT_GRID, KIT_NODE_H, KIT_NODE_W, KIT_PAD } from '../../../content/diagramKit'
import { loadEngine } from '../../../lib/engines'
import type { KitCanvas, KitLink } from '../../../rules/designCanvas'

export interface NodeBox { left: number; top: number; w: number; h: number }
export interface KitGeometry { boxes: Map<string, NodeBox>; width: number; height: number }

/** Minimum stage so there is room to drop and drag (40 × 24 cells). */
export const STAGE_MIN_W = 960
export const STAGE_MIN_H = 576
/** diagram.js `route`: ports sit at py + round(PROP_H × 0.62). */
export const PROP_H = 60

type LayoutFn = (d: unknown) => { nodes: { id: string; px: number; py: number; w: number; h: number }[]; W: number; H: number }

function engineLayout(): LayoutFn | null {
  const api = (window as unknown as { SRDiagram?: { layout?: LayoutFn } }).SRDiagram
  return typeof api?.layout === 'function' ? api.layout : null
}

/** Node boxes exactly where sr-diagram draws them (its own layout), with a fixed-box fallback before it loads. */
export function kitGeometry(canvas: KitCanvas, useEngine: boolean): KitGeometry {
  const boxes = new Map<string, NodeBox>()
  let width = 0
  let height = 0
  const layout = useEngine && canvas.nodes.length > 0 ? engineLayout() : null
  if (layout) {
    try {
      const r = layout(canvas)
      for (const n of r.nodes) boxes.set(n.id, { left: n.px, top: n.py, w: n.w, h: n.h })
      width = r.W
      height = r.H
    } catch {
      boxes.clear()
    }
  }
  for (const n of canvas.nodes) {
    if (boxes.has(n.id)) continue
    const b = { left: KIT_PAD + n.x * KIT_GRID, top: KIT_PAD + n.y * KIT_GRID, w: KIT_NODE_W, h: KIT_NODE_H }
    boxes.set(n.id, b)
    width = Math.max(width, b.left + b.w + KIT_PAD)
    height = Math.max(height, b.top + b.h + KIT_PAD)
  }
  return { boxes, width: Math.max(STAGE_MIN_W, width), height: Math.max(STAGE_MIN_H, height) }
}

/** Midpoint of the engine's orthogonal route from a's right port to b's left port (or the under-route for back edges). */
export function linkAnchor(geo: KitGeometry, l: KitLink): { x: number; y: number } | null {
  const a = geo.boxes.get(l.from)
  const b = geo.boxes.get(l.to)
  if (!a || !b) return null
  const ax = a.left + a.w
  const ay = a.top + Math.round(PROP_H * 0.62)
  const bx = b.left
  const by = b.top + Math.round(PROP_H * 0.62)
  if (bx >= ax + 16) return { x: Math.round((ax + bx) / 2), y: Math.round((ay + by) / 2) }
  const yb = Math.max(a.top + a.h, b.top + b.h) + 16
  return { x: Math.round((a.left + a.w / 2 + b.left + b.w / 2) / 2), y: yb }
}

/**
 * Bumps once `document.fonts.ready` resolves. The frozen engine measures text at render and can
 * correct node widths once web fonts finish loading; a layout computed before that (fonts still
 * showing the fallback face) would leave the click overlay drifted from the drawn boxes. Include
 * this in the layout memo's deps so it recomputes exactly once fonts settle.
 */
export function useFontsReadyVersion(): number {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const fonts = (document as unknown as { fonts?: { ready?: Promise<unknown> } }).fonts
    if (!fonts?.ready) return
    let live = true
    fonts.ready.then(() => { if (live) setVersion(v => v + 1) }).catch(() => {})
    return () => { live = false }
  }, [])
  return version
}

/** True once diagram.js has defined window.SRDiagram (never in jsdom). */
export function useDiagramEngine(): boolean {
  const [ready, setReady] = useState(() => typeof window !== 'undefined' && !!(window as { SRDiagram?: unknown }).SRDiagram)
  useEffect(() => {
    if (ready) return
    let live = true
    loadEngine('diagram').then(() => { if (live) setReady(true) }).catch(() => {})
    return () => { live = false }
  }, [ready])
  return ready
}
