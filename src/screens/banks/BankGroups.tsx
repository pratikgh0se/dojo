import { tipProps } from '../../ui/Tip'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cellLabel, cellTone, difficultyChip, NO_VALUE } from '../../rules/bankFilters'
import type { GroupView, ItemView } from '../../rules/banks'

export function BankGroups({ groups, onTick, renderActions }: {
  groups: GroupView[]; onTick: (item: ItemView) => void; renderActions?: (item: ItemView) => ReactNode
}) {
  return (
    <>
      {groups.map(g => (
        <section key={g.slug} className="bank-group" data-testid={`banks-group-${g.slug}`} aria-labelledby={`bank-group-${g.slug}`}>
          <div className="bank-group-head">
            <h3 id={`bank-group-${g.slug}`}>{g.title}</h3>
            <span className="bank-group-count" data-testid={`banks-group-count-${g.slug}`}>{g.done}/{g.total}</span>
          </div>
          <div className="bank-heat" data-testid={`banks-heatmap-${g.slug}`}>
            {g.items.map(i => <BankCell key={i.id} item={i} onTick={onTick} />)}
          </div>
          <ul className="bank-rows">
            {g.items.map(i => <BankRow key={i.id} item={i} onTick={onTick} actions={renderActions?.(i)} />)}
          </ul>
        </section>
      ))}
    </>
  )
}

function BankCell({ item, onTick }: { item: ItemView; onTick: (item: ItemView) => void }) {
  const cls = `bank-cell ${cellTone(item.difficulty)}${item.done ? ' done' : ''}`
  const label = cellLabel(item)
  const status = item.done ? 'done' : 'todo'
  if (item.plan) {
    return (
      <Link
        to={item.plan.href} className={`${cls} cube`} aria-label={label} title={label}
        data-testid={`bank-cell-${item.id}`} data-status={status} data-in-plan="true"
      />
    )
  }
  return (
    <button
      type="button" className={cls} aria-label={label} title={label} aria-pressed={item.done} disabled={item.readOnly}
      data-testid={`bank-cell-${item.id}`} data-status={status} data-in-plan="false" onClick={() => onTick(item)}
    />
  )
}

function BankRow({ item, onTick, actions }: { item: ItemView; onTick: (item: ItemView) => void; actions: ReactNode }) {
  return (
    <li
      className="bank-row" data-testid={`bank-item-${item.id}`} data-status={item.done ? 'done' : 'todo'}
      data-in-plan={item.plan ? 'true' : 'false'} data-ticket-id={item.ticketId}
    >
      {/* F6.10 / triage M16: the shared house checkbox (20 x 20, accent); its label is the row's 44 x 44 tap box */}
      <label className="sr-choice bank-tick-box">
        <input
          type="checkbox" className="bank-tick" data-testid="bank-item-tick" aria-label={`Done: ${item.name}`}
          checked={item.done} disabled={item.readOnly} onChange={() => onTick(item)}
        />
      </label>
      {item.url
        ? <a className="bank-name" data-testid="bank-item-link" href={item.url} target="_blank" rel="noopener noreferrer">{item.name}</a>
        : <span className="bank-name">{item.name}</span>}
      {/* UAT cu-6 P3-14: an empty value still reads `—` (S-12), but as plain muted text, not a bordered box */}
      <span className="chip bank-chip-diff" data-testid="bank-item-difficulty" data-empty={difficultyChip(item.difficulty) === NO_VALUE ? 'true' : undefined} {...(difficultyChip(item.difficulty) === NO_VALUE ? tipProps('No difficulty for this item') : {})}>{difficultyChip(item.difficulty)}</span>
      <span className="chip" data-testid="bank-item-pattern" data-empty={item.pattern ? undefined : 'true'} {...(item.pattern ? {} : tipProps('No pattern for this item'))}>{item.pattern ?? NO_VALUE}</span>
      {item.plan && <Link className="bank-inplan" data-testid="bank-item-inplan" to={item.plan.href}>{item.plan.marker}</Link>}
      {actions}
    </li>
  )
}
