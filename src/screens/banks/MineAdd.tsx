import { useState } from 'react'
import { useDb } from '../../app/providers'
import { callJob } from '../../data/aiActions'
import { addMineItem, updateMineItem, type MineDraft } from '../../data/bankActions'
import { safeWrite } from '../../data/safeWrite'
import { now } from '../../lib/clock'
import { newId } from '../../lib/id'
import { isAtlasPattern } from '../../rules/bankPatterns'
import { UNTAGGED, type BankEntry, type Banks, type PlanRef } from '../../rules/banks'
import { isDuplicateInMine, knownItem, MINE_DUPLICATE, mineDifficulty, parseMineInput, sourceOfUrl } from '../../rules/mine'
import { Button } from '../../ui/primitives'
import { MineSuggestion } from './MineSuggestion'

type Phase =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'suggest'; draft: MineDraft; note: string }

export function MineAdd({ banks, refs, editRow, onEditDone }: {
  banks: Banks; refs: Map<string, PlanRef>; editRow: BankEntry | null; onEditDone: () => void
}) {
  const d = useDb()
  const [input, setInput] = useState('')
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [notice, setNotice] = useState<string | null>(null)
  const ticketIdOf = (key: string) => refs.get(key)?.ticketId ?? key

  async function classify() {
    const text = input.trim()
    if (!text) return
    setNotice(null)
    const p = parseMineInput(text)
    const known = knownItem(p, banks)
    if (isDuplicateInMine(p, known, banks.mine.entries)) {
      setPhase({ kind: 'idle' })
      setNotice(MINE_DUPLICATE)
      return
    }
    if (known) {
      const e = known.entry
      setPhase({
        kind: 'suggest', note: `Known item · ${known.label}`,
        draft: {
          key: e.id, name: e.name, url: e.url ?? p.url, num: e.num, pattern: e.pattern, difficulty: mineDifficulty(e.difficulty),
          rating: typeof e.difficulty === 'number' ? e.difficulty : undefined,
          source: p.source, input: text, ticketId: ticketIdOf(e.id),
        },
      })
      return
    }
    setPhase({ kind: 'loading' })
    const res = await callJob(d, 'classify', { ticket: null, context: { input: text } }, now())
    if (!res.ok) {
      setPhase({ kind: 'error', message: res.error })
      return
    }
    // C-BANKS §2: classify supplies only pattern and difficulty; title and source are derived.
    const key = p.id ?? newId('mine', now())
    const pattern = isAtlasPattern(res.output.pattern) ? res.output.pattern : null
    const difficulty = mineDifficulty(res.output.difficulty ?? null)
    setPhase({
      kind: 'suggest', note: res.output.note ?? `Suggested ${pattern ?? UNTAGGED} · ${difficulty}`,
      draft: { key, name: p.title, url: p.url, pattern, difficulty, source: p.source, input: text, ticketId: ticketIdOf(key), classify: res.output },
    })
  }

  async function accept(draft: MineDraft) {
    const r = await safeWrite(() => addMineItem(d, draft, now()), setNotice)
    if (!r) return
    if (!r.ok) {
      setNotice(r.message)
      return
    }
    setInput('')
    setNotice(null)
    setPhase({ kind: 'idle' })
  }

  async function save(draft: MineDraft) {
    if (!editRow?.rowId) return
    const r = await safeWrite(() => updateMineItem(d, editRow.rowId as string, { name: draft.name, pattern: draft.pattern, difficulty: draft.difficulty }), setNotice)
    if (r && !r.ok) setNotice(r.message)
    onEditDone()
  }

  const editDraft: MineDraft | null = editRow && {
    key: editRow.id, name: editRow.name, url: editRow.url, pattern: editRow.pattern, difficulty: mineDifficulty(editRow.difficulty),
    source: sourceOfUrl(editRow.url), input: '', ticketId: ticketIdOf(editRow.id),
  }

  return (
    <div className="mine-add" data-testid="mine-add">
      <label className="banks-field">
        <span>URL or name</span>
        <textarea data-testid="mine-input" rows={2} value={input} onChange={e => setInput(e.target.value)} />
      </label>
      <div className="mine-buttons">
        <Button variant="accent" data-testid="mine-classify" disabled={!input.trim() || phase.kind === 'loading'} onClick={() => void classify()}>Classify</Button>
        {phase.kind === 'loading' && <span className="mine-loader" role="status" aria-label="Classifying"><i /><i /><i /></span>}
      </div>
      {notice && <p className="banks-meta" data-testid="mine-notice" role="status">{notice}</p>}
      {phase.kind === 'error' && (
        <div className="mine-error" data-testid="mine-error" role="alert">
          <code>{phase.message}</code>
          <Button onClick={() => void classify()}>Retry</Button>
        </div>
      )}
      {editDraft
        ? <MineSuggestion key={`edit-${editDraft.key}`} mode="edit" initial={editDraft} note={`Editing ${editDraft.name}`} onSave={d2 => void save(d2)} onCancel={onEditDone} />
        : phase.kind === 'suggest' && (
          <MineSuggestion key={`add-${phase.draft.key}`} mode="add" initial={phase.draft} note={phase.note} onAccept={d2 => void accept(d2)} onCancel={() => setPhase({ kind: 'idle' })} />
        )}
    </div>
  )
}
