// Pure layout math for chart text. SVG font-size lives in the same user-unit
// coordinate space as bar geometry, so when a chart's viewBox is stretched to
// fill a wide panel (`width: 100%` in charts.css) the browser scales the text
// right along with the bars — a 7-unit label that looks fine at the chart's
// intrinsic size renders 30px+ tall in a 1280px panel. These helpers let a
// chart measure the px-per-user-unit scale the browser is actually applying
// (via ResizeObserver, see useChartScale.ts) and counteract it: draw the
// label at a *user-unit* font-size that renders at a fixed CSS pixel size no
// matter how wide the container is.

/** Target CSS pixel size for chart labels/values, independent of container width. */
export const CHART_LABEL_PX = 14

/** Rough average glyph width as a fraction of font-size, for the pixel/mono chart fonts. */
const CHAR_WIDTH_FACTOR = 0.62

/**
 * Rough rendered width (in the same units as `targetPx`) of one glyph at
 * `targetPx`. Chart layout math (e.g. StackedColumns' column pitch) uses this
 * to size a labelled slot to the label's own font, instead of a separately
 * hand-tuned constant that can drift out of sync with the actual font size.
 */
export function avgCharWidth(targetPx: number = CHART_LABEL_PX): number {
  return targetPx * CHAR_WIDTH_FACTOR
}

/** A usable px-per-user-unit scale: 1 until layout is measured (or where there is no ResizeObserver). */
export function usableScale(scale: number): number {
  return Number.isFinite(scale) && scale > 0 ? scale : 1
}

/**
 * The user-unit font-size to draw at so the label renders at `targetPx` CSS
 * pixels once the browser applies `scale` px-per-user-unit to the SVG
 * (scale = rendered width / viewBox width). `scale` is unknown before layout
 * (e.g. server render, or a non-DOM test) or in an environment without
 * ResizeObserver — callers pass 1 in that case, which draws the label at
 * exactly `targetPx` user units, matching the SVG's default 1-unit-per-px
 * sizing so nothing looks broken before the real scale is measured.
 */
export function labelFontSize(scale: number, targetPx: number = CHART_LABEL_PX): number {
  if (!Number.isFinite(scale) || scale <= 0) return targetPx
  return targetPx / scale
}

/**
 * Truncates `label` with an ellipsis so it fits in `availablePx` CSS pixels
 * once rendered at `targetPx`. Returns the label unchanged when it already
 * fits, and never returns an empty string (falls back to a single ellipsis
 * character) so a slot always shows something.
 */
export function fitLabel(label: string, availablePx: number, targetPx: number = CHART_LABEL_PX): string {
  const charPx = targetPx * CHAR_WIDTH_FACTOR
  if (!Number.isFinite(availablePx) || availablePx <= 0 || charPx <= 0) return label
  const maxChars = Math.floor(availablePx / charPx)
  if (label.length <= maxChars) return label
  if (maxChars <= 1) return '…'
  return `${label.slice(0, maxChars - 1)}…`
}

export type LabelAnchor = 'start' | 'middle' | 'end'

/**
 * Which indices, among a set of candidate label positions, should actually
 * show a label so they don't overlap: always the first and last, and then
 * every `every`-th one in between (the existing spacing rule chart columns
 * already used, generalized so it also guarantees the edges are kept).
 */
export function thinnedIndices(count: number, every: number): number[] {
  if (count <= 0) return []
  const step = Math.max(1, Math.floor(every))
  const out: number[] = []
  for (let i = 0; i < count; i += step) out.push(i)
  const last = count - 1
  if (out[out.length - 1] !== last) out.push(last)
  return out
}

/**
 * Anchor + edge-safe x for a label at `index` among `shown` indices (as
 * returned by `thinnedIndices`), given the label's natural centered x
 * (`centerX`) and the chart's plotting bounds [0, width]. The first shown
 * label is left-anchored at the chart's left edge and the last is
 * right-anchored at the right edge, so neither can render past the chart's
 * own bounding box regardless of how the SVG is scaled; everything in
 * between stays centered on its column.
 */
export function edgeSafeLabel(index: number, shown: readonly number[], centerX: number, width: number): { x: number; anchor: LabelAnchor } {
  if (shown.length <= 1) return { x: centerX, anchor: 'middle' }
  if (index === shown[0]) return { x: 0, anchor: 'start' }
  if (index === shown[shown.length - 1]) return { x: width, anchor: 'end' }
  return { x: centerX, anchor: 'middle' }
}
