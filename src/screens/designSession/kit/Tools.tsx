import { FRAMES_MAX, STICKY_MAX } from '../../../rules/designCanvas'
import { SCHEMA_MAX_TABLES } from '../../../rules/designNotes'

export interface ToolsProps {
  locked: boolean
  notes: number
  frames: number
  tables: number
  onCustom: () => void
  onNote?: () => void
  onTable?: () => void
  onFrame?: () => void
}

/** Box, Note, Table, Frame: the four canvas items v2 adds, next to the kit tiles. A button whose handler is absent is disabled. */
export function Tools({ locked, notes, frames, tables, onCustom, onNote, onTable, onFrame }: ToolsProps) {
  return (
    <div className="kit-tools" role="group" aria-label="Canvas tools" data-testid="kit-tools">
      <button type="button" className="sr-btn sr-btn-control" data-testid="kit-add-custom" aria-label="Add custom box" title="Custom box (C)" disabled={locked} onClick={onCustom}>Box</button>
      <button type="button" className="sr-btn sr-btn-control" data-testid="kit-add-note" aria-label="Add text note" title="Text note (N)" disabled={locked || !onNote || notes >= STICKY_MAX} onClick={onNote}>Note</button>
      <button type="button" className="sr-btn sr-btn-control" data-testid="kit-add-table" aria-label="Add schema table" title="Schema table (T)" disabled={locked || !onTable || tables >= SCHEMA_MAX_TABLES} onClick={onTable}>Table</button>
      <button type="button" className="sr-btn sr-btn-control" data-testid="kit-add-frame" aria-label="Add frame" title="Frame (G groups the selected block)" disabled={locked || !onFrame || frames >= FRAMES_MAX} onClick={onFrame}>Frame</button>
    </div>
  )
}

/** The caps behind Note and Frame, shown in the canvas footer (`kit-count-notes`, `kit-count-frames`). */
export function ToolCounts({ notes, frames }: { notes: number; frames: number }) {
  return (
    <span className="kit-tools-counts">
      <span className="kit-tools-count" data-testid="kit-count-notes">{notes} of {STICKY_MAX} notes</span>
      <span className="kit-tools-count" data-testid="kit-count-frames">{frames} of {FRAMES_MAX} frames</span>
    </span>
  )
}
