import { STAGE_COUNT } from '../../rules/capstone'
import type { EvidenceCounts } from '../../rules/stageCubes'
import { focusRegion, REGION_IDS, Region } from './Region'

const TILES: { testId: string; label: string; target: string; value: (c: EvidenceCounts) => string }[] = [
  { testId: 'ai-evidence-stages', label: 'Stages at 3 cubes', target: REGION_IDS.cubes, value: c => `${c.stages}/${STAGE_COUNT}` },
  { testId: 'ai-evidence-measured', label: 'Artifacts measured', target: REGION_IDS.build, value: c => `${c.measured}/${c.artifacts}` },
  { testId: 'ai-evidence-blank', label: 'Blank tests passed', target: REGION_IDS.cubes, value: c => String(c.blank) },
]

/** R1 (C-PROJECTS §2.1): three tiles, each a button that focuses its owning region. */
export function EvidenceTiles({ counts }: { counts: EvidenceCounts }) {
  return (
    <Region id={REGION_IDS.evidence} title="Evidence" testId="ai-evidence" className="p-grid-full">
      <div className="p-evidence">
        {TILES.map(t => (
          <button key={t.testId} type="button" className="sr-tile p-evi" onClick={() => focusRegion(t.target)}>
            <span className="p-evi-label">{t.label}</span>
            <b className="p-evi-value" data-testid={t.testId}>{t.value(counts)}</b>
          </button>
        ))}
      </div>
    </Region>
  )
}
