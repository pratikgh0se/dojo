import { pad2 } from '../../lib/dates'
import { stageName } from '../../rules/artifacts'
import { CELLS, LEARN_COLUMNS, LEARN_LABEL, learnBoard, type StageCubes } from '../../rules/stageCubes'
import { CubeMark } from './CubeMark'
import { REGION_IDS, Region } from './Region'

/** R3 (C-PROJECTS §2.3): derived, not draggable. Column = consecutive full cubes from Learn. */
export function LearnBoard({ cubes }: { cubes: StageCubes[] }) {
  const cols = learnBoard(cubes)
  return (
    <Region id={REGION_IDS.learn} title="Learn board" testId="board-learn">
      <div className="p-kanban p-kanban-4">
        {LEARN_COLUMNS.map(col => (
          <div key={col} className="p-kcol">
            <h3 className="p-kcol-head">{LEARN_LABEL[col]} · {cols[col].length}</h3>
            <ul role="list" aria-label={LEARN_LABEL[col]} className="p-klist" data-testid={`board-learn-col-${col}`}>
              {cols[col].map(c => (
                <li key={c.stage} className="p-kcard" data-testid="board-learn-card" data-stage={pad2(c.stage)}>
                  <span className="p-kcard-title" aria-hidden="true">ST {pad2(c.stage)}</span>
                  <span className="vh">{stageName(c.stage)}</span>
                  <span className="p-mini" aria-hidden="true">
                    {CELLS.map(cell => <CubeMark key={cell} size="sm" state={c[cell].state} />)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Region>
  )
}
