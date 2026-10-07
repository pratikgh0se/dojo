import { useState } from 'react'
import { ATLAS_PATTERNS } from '../../content/patterns'
import type { MineDraft } from '../../data/bankActions'
import type { Difficulty } from '../../data/types'
import { isAtlasPattern } from '../../rules/bankPatterns'
import { UNTAGGED } from '../../rules/banks'
import { DIFFICULTIES, DIFFICULTY_LABELS } from '../../rules/dsa'
import { Button } from '../../ui/primitives'

/** Editable suggestion (add) or row editor (edit). Parent remounts it with a new `key` per draft. */
export function MineSuggestion({ mode, initial, note, onAccept, onSave, onCancel }: {
  mode: 'add' | 'edit'
  initial: MineDraft
  note: string
  onAccept?: (d: MineDraft) => void
  onSave?: (d: MineDraft) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(initial)
  const name = draft.name.trim()
  const done = () => ({ ...draft, name })
  return (
    <div className="mine-suggestion sr-panel" data-testid="mine-suggestion" role="group" aria-label={mode === 'add' ? 'Suggestion' : `Edit ${initial.name}`}>
      <p className="mine-note" data-testid="mine-suggestion-note">{note}</p>
      <p className="banks-meta">Source <span data-testid="mine-source">{draft.source}</span></p>
      <label className="banks-field">
        <span>Title</span>
        <input
          aria-label="Title" data-testid="mine-title" value={draft.name}
          onChange={e => setDraft({ ...draft, name: e.target.value })}
        />
      </label>
      <label className="banks-field">
        <span>Pattern</span>
        <select
          aria-label="Pattern" data-testid="mine-pattern" value={draft.pattern ?? ''}
          onChange={e => setDraft({ ...draft, pattern: isAtlasPattern(e.target.value) ? e.target.value : null })}
        >
          <option value="">{UNTAGGED}</option>
          {ATLAS_PATTERNS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </label>
      <label className="banks-field">
        <span>Difficulty</span>
        <select
          aria-label="Difficulty" data-testid="mine-difficulty" value={draft.difficulty}
          onChange={e => setDraft({ ...draft, difficulty: e.target.value as Difficulty })}
        >
          {DIFFICULTIES.map(k => <option key={k} value={k}>{DIFFICULTY_LABELS[k]}</option>)}
        </select>
      </label>
      <div className="mine-buttons">
        {mode === 'add'
          ? <Button variant="accent" data-testid="mine-accept" disabled={!name} onClick={() => onAccept?.(done())}>Accept</Button>
          : <Button variant="accent" data-testid="mine-save" disabled={!name} onClick={() => onSave?.(done())}>Save</Button>}
        <Button data-testid="mine-cancel" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}
