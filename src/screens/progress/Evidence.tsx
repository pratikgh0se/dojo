import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { LensValues } from '../../rules/designEvidence'
import { passRate, type DsaEvidence } from '../../rules/evidence'
import type { EvidenceCounts } from '../../rules/stageCubes'
import { LensRadar } from '../designs/LensRadar'

function EvStat({ k, label, value, to }: { k: string; label: string; value: string; to: string }) {
  return (
    <Link to={to} className="ev-stat" data-testid={`ev-${k}`}>
      <span className="ev-label">{label}</span>
      <b className="ev-value" data-testid={`ev-${k}-value`}>{value}</b>
    </Link>
  )
}

function Group({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="ev-col" role="group" aria-label={name}>
      <h3 className="ev-col-title">{name}</h3>
      {children}
    </div>
  )
}

export interface EvidenceProps {
  dsa: DsaEvidence
  /** plan problems done without a Do session (a tick): in the DSA tile, not in the stats (cu-3 P3-6) */
  dsaTicked?: number
  design: { dives: number; divesTotal: number; redesign: { passed: number; total: number }; radar: { stats: { last6: LensValues; mean: LensValues }; count: number } }
  ai: EvidenceCounts
}

/** TRACKING "What ties the three together on Progress": every number is a click into the tab that owns it. */
export function Evidence({ dsa, dsaTicked = 0, design, ai }: EvidenceProps) {
  return (
    <section className="sr-panel progress-evidence" aria-label="Evidence" data-testid="progress-evidence">
      <h2 className="sr-panel-title">Evidence</h2>
      <div className="ev-cols">
        <Group name="DSA">
          <EvStat k="dsa-solved" label="Solved without help" value={String(dsa.solved)} to="/dsa" />
          <EvStat k="dsa-help" label="Solved with help" value={String(dsa.help)} to="/dsa" />
          <EvStat k="dsa-gaveup" label="Given up" value={String(dsa.gaveUp)} to="/dsa" />
          <EvStat k="dsa-redo" label="Redo pass rate" value={passRate(dsa.redoPassed, dsa.redoTotal)} to="/dsa" />
          {/* the DSA tile counts every problem marked done; these stats only those worked in Do (a tick is no evidence) */}
          {dsaTicked > 0 && (
            <p className="hint" data-testid="ev-dsa-ticked">
              {dsaTicked} more {dsaTicked === 1 ? 'problem is' : 'problems are'} marked done without a Do attempt, so not counted above.
            </p>
          )}
        </Group>
        <Group name="Design">
          <EvStat k="design-dives" label="Deep dives answered in full" value={passRate(design.dives, design.divesTotal)} to="/designs" />
          <Link to="/designs" className="ev-radar-link" data-testid="ev-design-radar">
            <LensRadar stats={design.radar.stats} count={design.radar.count} testId="ev-design-radar-img" />
          </Link>
          <EvStat k="design-redesign" label="Redesign pass rate" value={passRate(design.redesign.passed, design.redesign.total)} to="/designs" />
        </Group>
        <Group name="AI">
          <EvStat k="ai-stages" label="Stages at 3 cubes" value={`${ai.stages}/12`} to="/ai" />
          <EvStat k="ai-measured" label="Artifacts measured" value={`${ai.measured}/${ai.artifacts}`} to="/ai" />
          <EvStat k="ai-blank" label="Blank tests passed" value={String(ai.blank)} to="/ai" />
        </Group>
      </div>
    </section>
  )
}
