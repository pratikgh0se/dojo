import type { DesignSession } from '../../data/types'
import {
  doneSessions, lensStats, redesignPassRate, redesignQueue, shelfTiers, vocabCount, vocabText, wallRows,
} from '../../rules/designEvidence'
import type { PlanDesignRef } from '../../rules/designs'
import { DeepDiveWall } from './DeepDiveWall'
import { DiagramShelf } from './DiagramShelf'
import { LensRadar } from './LensRadar'
import { LensTrend } from './LensTrend'
import { Redesigns } from './Redesigns'
import './evidence.css'

/** TRACKING §1 "Visualisations (Designs tab, new section above the tier ladder)". */
export function DesignEvidence({
  designs, sessions, nowMs,
}: { designs: PlanDesignRef[]; sessions: DesignSession[]; nowMs: number }) {
  const done = doneSessions(sessions)
  return (
    <section className="sr-panel ev" data-testid="design-evidence" aria-label="Design evidence">
      <h2 className="sr-panel-title">Design evidence</h2>
      <div className="ev-top">
        <LensRadar stats={lensStats(done)} count={done.length} />
        <DeepDiveWall rows={wallRows(designs, done)} />
      </div>
      <LensTrend done={done} />
      <DiagramShelf tiers={shelfTiers(designs, done)} />
      <p className="ev-vocab" data-testid="design-vocab">{vocabText(vocabCount(done))}</p>
      <Redesigns rows={redesignQueue(designs, sessions, nowMs)} rate={redesignPassRate(sessions)} />
    </section>
  )
}
