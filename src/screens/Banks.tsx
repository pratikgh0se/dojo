import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useDb, usePlan } from '../app/providers'
import { BANK_TABS, type BankTabId } from '../content/banks/meta'
import { useShippedBanks } from '../content/banks/useShippedBanks'
import { removeMineItem } from '../data/bankActions'
import { safeWrite } from '../data/safeWrite'
import { useBankItems, useSettings, useTickets } from '../data/hooks'
import { isTypingTarget } from '../lib/keys'
import { allViews, buildBanks, countDone, groupViews, planRefs, type ItemView } from '../rules/banks'
import { applyFilters, difficultyOptions, patternOptions, readBankId, readFilters, sanitizeFilters } from '../rules/bankFilters'
import { liveTicketMap } from '../rules/board'
import { Button, useToast } from '../ui/primitives'
import { useBankTick } from '../ui/useBankTick'
import { BankControls, BankEmpty, type FilterPatch } from './banks/BankControls'
import { BankGroups } from './banks/BankGroups'
import { BankHeader } from './banks/BankHeader'
import { BankSwitcher } from './banks/BankSwitcher'
import { LadderImport } from './banks/LadderImport'
import { MineAdd } from './banks/MineAdd'
import './banks.css'
import { Loading } from '../ui/Loading'

export function Banks() {
  const plan = usePlan()
  const tickets = useTickets()
  const rows = useBankItems()
  const settings = useSettings()
  const [params, setParams] = useSearchParams()
  const searchRef = useRef<HTMLInputElement>(null)
  const d = useDb()
  const toast = useToast()
  const [editing, setEditing] = useState<string | null>(null)
  const tick = useBankTick(settings?.startDate ?? '')
  const shippedBanks = useShippedBanks()
  const refs = useMemo(() => planRefs(plan), [plan])
  const banks = useMemo(() => (rows && shippedBanks ? buildBanks(plan, shippedBanks, rows) : null), [plan, rows, shippedBanks])
  const views = useMemo(() => (banks && tickets ? allViews(banks, refs, liveTicketMap(tickets)) : null), [banks, refs, tickets])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return
      e.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!banks || !views || !settings) return <Loading />

  const bankId = readBankId(params)
  const entries = banks[bankId].entries
  const diffOptions = difficultyOptions(bankId, entries)
  const patOptions = patternOptions(bankId, entries)
  const filters = sanitizeFilters(readFilters(params), diffOptions, patOptions)
  const all = views[bankId]
  const visible = applyFilters(all, filters)
  const tab = BANK_TABS.find(t => t.id === bankId) ?? BANK_TABS[0]
  const { done, total } = countDone(all)

  // Bank switch pushes a history entry (Back restores it) and drops every filter (C-BANKS S-20).
  const selectBank = (id: BankTabId) => setParams(new URLSearchParams({ bank: id }))
  const clearFilters = () => setParams(new URLSearchParams({ bank: bankId }), { replace: true })
  const patchFilters = (patch: FilterPatch) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined || v === '') next.delete(k)
      else next.set(k, v)
    }
    setParams(next, { replace: true })
  }

  const removeMine = async (item: ItemView) => {
    if (!item.rowId) return
    const r = await safeWrite(() => removeMineItem(d, item.rowId as string), m => toast(m, 'danger'))
    if (r && !r.ok) toast(r.message, 'danger')
  }
  const mineActions = (item: ItemView) => (
    <span className="mine-actions">
      <Button aria-label={`Edit ${item.name}`} onClick={() => setEditing(item.rowId ?? null)}>Edit</Button>
      <Button variant="danger" aria-label={`Remove ${item.name}`} disabled={item.done} onClick={() => void removeMine(item)}>Remove</Button>
    </span>
  )

  return (
    <div className="content-screen banks" data-testid="banks-page">
      <h1 className="screen-title banks-title">Banks</h1>
      <BankHeader tab={tab} done={done} total={total} visible={visible.length} />
      <BankSwitcher tabs={BANK_TABS.map(t => ({ def: t, ...countDone(views[t.id]) }))} selected={bankId} onSelect={selectBank} />
      <div role="tabpanel" id="banks-panel" aria-labelledby={`banks-tab-${bankId}`} className="banks-panel">
        <BankControls
          diffOptions={diffOptions} patOptions={patOptions} filters={filters}
          onChange={patchFilters} onClear={clearFilters} searchRef={searchRef}
        >
          {bankId === 'mine' && (
            <MineAdd
              banks={banks} refs={refs}
              editRow={banks.mine.entries.find(e => e.rowId === editing) ?? null}
              onEditDone={() => setEditing(null)}
            />
          )}
          {bankId === 'codeforces' && <LadderImport existingIds={new Set(banks.codeforces.entries.map(e => e.id))} />}
        </BankControls>
        <BankGroups
          groups={groupViews(banks[bankId].groups, all, visible)}
          onTick={item => void tick(item, bankId)}
          renderActions={bankId === 'mine' ? mineActions : undefined}
        />
        {visible.length === 0 && <BankEmpty mineEmpty={bankId === 'mine' && all.length === 0} onClear={clearFilters} />}
      </div>
    </div>
  )
}
