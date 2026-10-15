import type { EvidenceRef } from '../ai/types'
import { noteEvidenceId } from '../ai/types'
import type { DesignSession } from '../data/types'
import { nodeView, normalizeCanvas } from './designCanvas'
import { NOTE_SECTIONS, normalizeNotes } from './designNotes'

/** What an evidence chip shows: the kind word (`Notes`, `Diagram`, or none for a diagram name that is no longer drawn) and the target's name. */
export interface EvidenceChip { kind: 'Notes' | 'Diagram' | null; title: string }

const LABEL_MAX = 80
const norm = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase()

/** The names a diagram citation can match, as drawn now: node labels (a table block wears its schema name), frame labels and sticky-note text. */
export function canvasLabels(session: Pick<DesignSession, 'canvas' | 'notes'>): string[] {
  const c = normalizeCanvas(session.canvas, { lenientLinks: true })
  const notes = normalizeNotes(session.notes)
  const out = [
    ...c.nodes.map(n => nodeView(n, notes).label),
    ...c.zones.map(z => z.label),
    ...c.notes.map(n => n.text.trim().replace(/\s+/g, ' ').slice(0, LABEL_MAX)),
  ].map(l => l.trim()).filter(Boolean)
  const seen = new Set<string>()
  return out.filter(l => { const k = norm(l); if (seen.has(k)) return false; seen.add(k); return true })
}

/**
 * One stored citation to its chip. A notes target is a section id and shows the section's title; an unknown section yields null (dropped).
 * A diagram target that matches a current canvas label (case-insensitive) shows the target as stored with the `Diagram` kind (DESIGN-99); one that matches
 * none (the box was renamed or deleted) is kept as plain text with no kind.
 */
export function chipFor(ev: EvidenceRef, labels: readonly string[]): EvidenceChip | null {
  if (ev.source === 'notes') {
    const id = noteEvidenceId(ev.target)
    const section = NOTE_SECTIONS.find(s => s.id === id)
    return section ? { kind: 'Notes', title: section.title } : null
  }
  const hit = labels.find(l => norm(l) === norm(ev.target))
  return { kind: hit ? 'Diagram' : null, title: ev.target }
}

/** The chips of one grade item, in stored order; a grade stored before F3 (no evidence) has none. */
export function evidenceChips(evidence: readonly EvidenceRef[] | undefined, labels: readonly string[]): EvidenceChip[] {
  return (evidence ?? []).flatMap(e => { const c = chipFor(e, labels); return c ? [c] : [] })
}
