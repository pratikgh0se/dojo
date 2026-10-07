import { Cube } from './Cube'

export function Meter({ segments = 12, on, label, stretch = false }: { segments?: number; on: number; label: string; stretch?: boolean }) {
  return (
    <div
      className={`sr-meter${stretch ? ' stretch' : ''}`} role="meter" aria-label={label}
      aria-valuemin={0} aria-valuemax={segments} aria-valuenow={on}
    >
      {Array.from({ length: segments }, (_, i) =>
        stretch
          ? <span key={i} className="sr-cube" data-on={i < on ? 'true' : 'false'} aria-hidden="true" />
          : <Cube key={i} on={i < on} />,
      )}
    </div>
  )
}
