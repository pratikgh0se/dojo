import './pips.css'

/**
 * A row of square pips: `on` lit, and (optionally) one `cur` outlined. It reads as a meter to a screen reader and draws no text,
 * so it adds no visible words to the screen it sits on.
 */
export function Pips({ count, on, cur, label, className = '' }: { count: number; on: number; cur?: number; label: string; className?: string }) {
  const n = Math.max(0, Math.min(count, 12))
  const lit = Math.max(0, Math.min(on, n))
  return (
    <span className={`pips ${className}`.trim()} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={n} aria-valuenow={lit}>
      {Array.from({ length: n }, (_, i) => <i key={i} className={i < lit ? 'on' : i === cur ? 'cur' : ''} />)}
    </span>
  )
}
