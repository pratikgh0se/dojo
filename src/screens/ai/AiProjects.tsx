import { useRef, useState } from 'react'
import type { BlankTest, Ticket } from '../../data/types'
import { pad2 } from '../../lib/dates'
import { useQuery } from '../../lib/useQueryParam'
import type { ArtifactRecord } from '../../rules/artifacts'
import { allStageCubes, evidenceCounts } from '../../rules/stageCubes'
import { ArtifactDialog } from './ArtifactDialog'
import { ArtifactTimeline } from './ArtifactTimeline'
import { BlankTestDialog } from './BlankTestDialog'
import { BuildBoard, openButtonSelector } from './BuildBoard'
import { CubeLadder } from './CubeLadder'
import { EvidenceTiles } from './EvidenceTiles'
import { LearnBoard } from './LearnBoard'
import { MeasuresWall } from './MeasuresWall'
import './projects.css'

export interface AiProjectsProps {
  tickets: Ticket[]
  artifacts: ArtifactRecord[]
  blankTests: BlankTest[]
  startDate: string
  nowMs: number
  lastSprint: number
  onStage: (stage: number) => void
}

const ADD_BUTTON = '[data-testid="artifact-add"]'
const q = (sel: string) => document.querySelector<HTMLElement>(sel)

/** The six C-PROJECTS regions, in order, above the existing M5c content, plus their dialogs. */
export function AiProjects({ tickets, artifacts, blankTests, startDate, nowMs, lastSprint, onStage }: AiProjectsProps) {
  const { params, set } = useQuery()
  const [blankStage, setBlankStage] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const afterClose = useRef<string | null>(null)
  const cubes = allStageCubes(tickets, artifacts, blankTests)
  const counts = evidenceCounts(cubes, artifacts, blankTests)
  const openId = params.get('artifact')
  const open = openId ? artifacts.find(a => a.id === openId) ?? null : null
  const closeOpen = () => set({ artifact: null })
  return (
    <>
      <div className="p-grid">
        <EvidenceTiles counts={counts} />
        <CubeLadder cubes={cubes} blankTests={blankTests} onStage={onStage} onBlank={setBlankStage} />
        <LearnBoard cubes={cubes} />
        <BuildBoard
          artifacts={artifacts}
          onOpen={id => { afterClose.current = null; set({ artifact: id }) }}
          onAdd={() => setAdding(true)}
        />
        <ArtifactTimeline artifacts={artifacts} startDate={startDate} nowMs={nowMs} lastSprint={lastSprint} />
        <MeasuresWall artifacts={artifacts} />
      </div>
      {blankStage !== null && (
        <BlankTestDialog
          stage={blankStage}
          onClose={() => setBlankStage(null)}
          returnFocus={() => q(`[data-testid="ai-blank-${pad2(blankStage)}"]`)}
        />
      )}
      {adding && (
        <ArtifactDialog
          artifact={null}
          startDate={startDate}
          onClose={() => setAdding(false)}
          onSaved={() => setAdding(false)}
          onDeleted={() => setAdding(false)}
          returnFocus={() => q(ADD_BUTTON)}
        />
      )}
      {open && (
        <ArtifactDialog
          key={open.id}
          artifact={open}
          startDate={startDate}
          onClose={closeOpen}
          onSaved={closeOpen}
          onDeleted={() => { afterClose.current = ADD_BUTTON; closeOpen() }}
          returnFocus={() => q(afterClose.current ?? openButtonSelector(open.id))}
        />
      )}
    </>
  )
}
