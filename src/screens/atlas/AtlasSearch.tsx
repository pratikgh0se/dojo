import { useState } from 'react'
import { useDb } from '../../app/providers'
import { patternByLabel, type Pattern } from '../../content/atlas'
import { callJob } from '../../data/aiActions'
import { now } from '../../lib/clock'

export const NO_LOCAL = 'No local match. Press Enter to ask classify.'

/**
 * Search (labs contract §5.4, D-13): the parent filters rows while he types; Enter picks the first visible
 * row, or, when nothing matches, asks the AI `classify` job and lands on the row it names.
 */
export function AtlasSearch({
  query, onQuery, visible, onPick, selected,
}: {
  /** the pattern row now open (a classify match is only reported while it is still the open one) */
  selected?: string | null
  query: string
  onQuery: (q: string) => void
  visible: readonly Pattern[]
  onPick: (slug: string) => void
}) {
  const d = useDb()
  const [said, setSaid] = useState<{ text: string; slug?: string } | null>(null)
  // UAT cu-6 P3-7: "Matched by classify: X" is about row X; once another row is open it is stale and goes
  const live = said && (said.slug === undefined || selected === undefined || said.slug === selected) ? said.text : null
  const status = live ?? (query.trim() && visible.length === 0 ? NO_LOCAL : '')

  async function classify(text: string) {
    setSaid({ text: 'Asking classify…' })
    const r = await callJob(d, 'classify', { ticket: null, context: { input: text } }, now())
    const hit = r.ok ? patternByLabel(String((r.output as { pattern?: unknown }).pattern ?? '')) : undefined
    if (!hit) {
      setSaid({ text: 'No match.' })
      return
    }
    onQuery('')
    onPick(hit.slug)
    setSaid({ text: `Matched by classify: ${hit.label}`, slug: hit.slug })
  }

  return (
    <div className="atlas-search">
      <input
        type="search"
        aria-label="Search patterns or problems"
        placeholder="LeetCode number, problem name or phrase"
        value={query}
        onChange={e => {
          setSaid(null)
          onQuery(e.target.value)
        }}
        onKeyDown={e => {
          if (e.key !== 'Enter') return
          e.preventDefault()
          if (!query.trim()) return
          if (visible.length > 0) onPick(visible[0].slug)
          else void classify(query.trim())
        }}
      />
      <p role="status" className="hint" data-testid="atlas-search-status">{status}</p>
    </div>
  )
}
