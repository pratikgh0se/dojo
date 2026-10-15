import { GLYPHS, type GlyphName } from './glyphData'
import './glyph.css'

export type { GlyphName }
export type GlyphSize = 2 | 3 | 4

/** One path for the whole glyph: a rectangle per run of lit cells. */
export function glyphPath(rows: readonly string[]): string {
  let d = ''
  rows.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      if (row[x] !== '#') { x += 1; continue }
      let w = 1
      while (row[x + w] === '#') w += 1
      d += `M${x} ${y}h${w}v1h-${w}z`
      x += w
    }
  })
  return d
}

/**
 * A 7 x 7 Still Room glyph at a whole multiple of its grid (14, 21, 28 px). Decorative unless `label` is given.
 * `data-glyph` is the glyph name, or `mark` where a contract hook names a state (SKILLS-09: check, lock, next, progress, open).
 */
export function Glyph({ name, size = 2, label, className = '', mark }: { name: GlyphName; size?: GlyphSize; label?: string; className?: string; mark?: string }) {
  const px = 7 * size
  const a11y = label ? { role: 'img' as const, 'aria-label': label } : { 'aria-hidden': true as const, focusable: false as const }
  return (
    <svg className={`glyph ${className}`.trim()} width={px} height={px} viewBox="0 0 7 7" shapeRendering="crispEdges" fill="currentColor" data-glyph={mark ?? name} {...a11y}>
      <path d={glyphPath(GLYPHS[name])} />
    </svg>
  )
}
