import { useState } from 'react'
import { useDb } from '../../app/providers'
import { importLadder } from '../../data/bankActions'
import { safeWrite } from '../../data/safeWrite'
import { now } from '../../lib/clock'
import { ladderResultText, parseLadderJson } from '../../rules/cfLadder'
import { Button } from '../../ui/primitives'

export function LadderImport({ existingIds }: { existingIds: ReadonlySet<string> }) {
  const d = useDb()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  async function run() {
    const parsed = parseLadderJson(text)
    if (!parsed.ok) {
      setResult({ ok: false, text: parsed.error })
      return
    }
    const r = await safeWrite(() => importLadder(d, parsed.items, existingIds, now()), m => setResult({ ok: false, text: m }))
    if (r) setResult({ ok: true, text: ladderResultText(r.added, r.present) })
  }

  return (
    <div className="banks-import" data-testid="banks-import">
      <div className="mine-buttons">
        <Button aria-expanded={open} aria-controls="banks-import-body" onClick={() => setOpen(o => !o)}>Import ladder</Button>
      </div>
      {open && (
        <div id="banks-import-body" className="banks-import">
          <label className="banks-field">
            <span>Ladder JSON</span>
            <textarea rows={4} value={text} onChange={e => setText(e.target.value)} spellCheck={false} />
          </label>
          <div className="mine-buttons">
            <Button onClick={() => void run()}>Import</Button>
          </div>
          {result && (
            <p className={result.ok ? 'banks-meta' : 'mine-error'} data-testid="banks-import-result" role="status">{result.text}</p>
          )}
        </div>
      )}
    </div>
  )
}
