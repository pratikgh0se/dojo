import type { DiagramJson, SrAlgoJson } from '../../ai/types'
import type { AlgoJson } from '../../rules/algoJson'
import { AlgoPlayer } from '../../ui/algo/AlgoPlayer'
import { SrDiagram } from '../../ui/engines/SrDiagram'

export type PictureJson = { kind: 'dsa'; json: SrAlgoJson } | { kind: 'design'; json: DiagramJson }

/** VZ "four places" #1 and #4: a paid picture drawn by the one engine; it never records Atlas progress. */
export function PicturePlayer({ picture, title }: { picture: PictureJson; title: string }) {
  if (picture.kind === 'dsa') return <AlgoPlayer json={picture.json as AlgoJson} record={false} />
  return (
    <>
      <SrDiagram data={picture.json} view="2d" testId="ladder-picture-diagram" label={`Reference architecture for ${title}`} className="picture-diagram" />
      <ul className="vh" aria-label="Nodes">{picture.json.nodes.map(n => <li key={n.id}>{n.label ?? n.id}</li>)}</ul>
    </>
  )
}
