// What the app may know about a lab (GET /labs/info) and the authored hints (POST /labs/hint).
// Neither ever returns a reference file other than the 40-line excerpt of rung 3, and info returns no hint text.
import { join } from 'node:path'
import { readInside } from './defs.mjs'
import { LabError } from './common.mjs'

/** The fields of GET /labs/info (flat): the definition without hints, reference or directory. `repo` and `version` fill the app's `labs` row. */
export function labInfo(def) {
  return {
    title: def.title, path: def.path, repo: def.repo, version: def.version, timeoutSec: def.timeoutSec,
    tickets: [...def.tickets], closingTicket: def.closingTicket,
    milestones: def.milestones.map(m => ({ ticket: m.ticket, checkIds: [...m.checkIds] })),
    rubric: def.rubric.map(r => ({ id: r.id, text: r.text })),
  }
}

/** Rungs 1 and 2: the authored text. Rung 3: the authored text ('' when none) plus the reference excerpt { file, from, to, code }. */
export function labHint(def, ticketId, rung) {
  const m = def.milestones.find(x => x.ticket === ticketId)
  if (!m) throw new LabError('bad_request', 'That ticket has no hints in this lab.')
  if (rung !== 1 && rung !== 2 && rung !== 3) throw new LabError('bad_request', 'rung must be 1, 2 or 3.')
  const h = m.hints[rung - 1]
  if (rung < 3) return { text: h.text }
  const text = readInside(join(def.dir, 'reference'), h.ref.file)
  if (text === null) throw new LabError('unknown_lab', 'The reference file of this hint is missing.')
  const code = text.split('\n').slice(h.ref.from - 1, h.ref.to).join('\n')
  return { text: h.text ?? '', ref: { file: h.ref.file, from: h.ref.from, to: h.ref.to, code } }
}
