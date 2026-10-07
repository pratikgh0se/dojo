import { Fragment } from 'react'
import { CAPSTONE_STAGES } from '../../content/capstoneStages'
import type { BlankTest } from '../../data/types'
import { pad2 } from '../../lib/dates'
import { fmtDayMonYear } from '../../lib/fmtDate'
import { stageName } from '../../rules/artifacts'
import { checkpointAfterStage, stageLabel } from '../../rules/capstone'
import { CHECKPOINT_SPRINT } from '../../rules/overview'
import { blankRedoDue, CELLS, cubeName, latestBlankTest, type StageCubes } from '../../rules/stageCubes'
import { Button } from '../../ui/primitives'
import { CubeMark } from './CubeMark'
import { REGION_IDS, Region } from './Region'

const CHECKPOINT_AFTER = checkpointAfterStage([...CAPSTONE_STAGES], CHECKPOINT_SPRINT)

/** R2 (C-PROJECTS §2.2): one row per stage, three cubes, a Blank test button, the S38 checkpoint divider. */
export function CubeLadder({
  cubes, blankTests, onStage, onBlank,
}: { cubes: StageCubes[]; blankTests: BlankTest[]; onStage: (stage: number) => void; onBlank: (stage: number) => void }) {
  return (
    <Region id={REGION_IDS.cubes} title="Learn → build → prove" testId="ai-cube-ladder">
      <p className="hint p-legend">Learn = watch · Build = build + a commit · Prove = teach-back + a grade ≥ 3/5 or a solved blank test</p>
      <div className="p-scroll sc">
        <div role="table" aria-label="Stage cubes" className="p-cubes">
          {cubes.map(c => {
            const nn = pad2(c.stage)
            const last = latestBlankTest(blankTests, c.stage)
            return (
              <Fragment key={c.stage}>
                <div
                  role="row"
                  className="p-cube-row"
                  data-testid={`ai-cube-row-${nn}`}
                  data-complete={c.complete ? 'true' : 'false'}
                  onClick={() => onStage(c.stage)}
                >
                  <div role="rowheader" className="p-cube-head">
                    <button type="button" className="p-link" onClick={e => { e.stopPropagation(); onStage(c.stage) }}>
                      {stageName(c.stage)}
                    </button>
                  </div>
                  {CELLS.map(cell => (
                    <div role="cell" key={cell} className="p-cube-cell">
                      <CubeMark state={c[cell].state} name={cubeName(c.stage, c[cell])} testId={`ai-cube-${nn}-${cell}`} />
                    </div>
                  ))}
                  <div role="cell" className="p-cube-blank">
                    <Button
                      variant="quiet"
                      aria-label={`Blank test · ${stageLabel(c.stage)}`}
                      data-testid={`ai-blank-${nn}`}
                      onClick={e => { e.stopPropagation(); onBlank(c.stage) }}
                    >
                      Blank test
                    </Button>
                    {last?.outcome === 'not_yet' && (
                      <span className="p-due" data-testid="ai-blank-redo-due">Redo due {fmtDayMonYear(blankRedoDue(last))}</span>
                    )}
                  </div>
                </div>
                {c.stage === CHECKPOINT_AFTER && (
                  <div role="row" className="p-checkpoint" data-testid="ai-cube-checkpoint">
                    <div role="cell">Checkpoint · S{CHECKPOINT_SPRINT}</div>
                  </div>
                )}
              </Fragment>
            )
          })}
        </div>
      </div>
    </Region>
  )
}
