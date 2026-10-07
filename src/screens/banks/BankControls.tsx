import type { ReactNode, RefObject } from 'react'
import { hasFilters, STATUS_OPTIONS, type BankFilters, type Option } from '../../rules/bankFilters'
import { Button } from '../../ui/primitives'

export type FilterPatch = Partial<Record<'diff' | 'pattern' | 'status' | 'q', string | null>>

export function BankControls({ diffOptions, patOptions, filters, onChange, onClear, searchRef, children }: {
  diffOptions: Option[] | null
  patOptions: Option[] | null
  filters: BankFilters
  onChange: (patch: FilterPatch) => void
  onClear: () => void
  searchRef: RefObject<HTMLInputElement>
  children?: ReactNode
}) {
  return (
    <div className="banks-controls-wrap">
      <div className="banks-controls">
        <input
          ref={searchRef} type="search" className="banks-search" aria-label="Search this bank" placeholder="Search this bank"
          data-testid="banks-search" value={filters.q}
          onChange={e => onChange({ q: e.target.value })}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              e.preventDefault()
              onChange({ q: null })
            }
          }}
        />
        {diffOptions && <Select label="Difficulty" testId="banks-filter-difficulty" options={diffOptions} value={filters.diff ?? ''} onChange={v => onChange({ diff: v })} />}
        {patOptions && <Select label="Pattern" testId="banks-filter-pattern" options={patOptions} value={filters.pattern ?? ''} onChange={v => onChange({ pattern: v })} />}
        <Select label="Status" testId="banks-filter-status" options={STATUS_OPTIONS} value={filters.status ?? ''} onChange={v => onChange({ status: v })} />
        <Button variant="quiet" data-testid="banks-clear-filters" disabled={!hasFilters(filters)} onClick={onClear}>Clear filters</Button>
      </div>
      {children}
    </div>
  )
}

function Select({ label, testId, options, value, onChange }: {
  label: string; testId: string; options: readonly Option[]; value: string; onChange: (v: string) => void
}) {
  return (
    <select aria-label={label} data-testid={testId} className="banks-select" value={value} onChange={e => onChange(e.target.value)}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

export function BankEmpty({ mineEmpty, onClear }: { mineEmpty: boolean; onClear: () => void }) {
  if (mineEmpty) return <p className="banks-empty" data-testid="banks-empty">Nothing in Mine yet. Mine is your own problem list: paste a LeetCode or Codeforces link, or type a problem name, in the box above and press Classify to add it.</p>
  return (
    <div className="banks-empty" data-testid="banks-empty">
      <p>No items match.</p>
      <Button variant="quiet" onClick={onClear}>Clear filters</Button>
    </div>
  )
}
