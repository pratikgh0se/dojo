import type { BankTabDef } from '../../content/banks/meta'

export function BankHeader({ tab, done, total, visible }: { tab: BankTabDef; done: number; total: number; visible: number }) {
  const pct = total ? Math.round((100 * done) / total) : 0
  return (
    <header className="banks-header sr-panel" data-testid="banks-header">
      <h2 className="banks-bank-title">{tab.label}</h2>
      <div
        className="banks-progress" role="progressbar" aria-label={`${tab.label} progress`}
        aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} data-testid="banks-progress"
      >
        <span className="banks-progress-bar"><i style={{ width: `${pct}%` }} /></span>
        <span className="banks-progress-text">{done}/{total}</span>
      </div>
      <span className="banks-meta" data-testid="banks-visible-count">Showing {visible} of {total}</span>
      {tab.id === 'plan' && <span className="banks-meta">From your plan</span>}
      {tab.source && (
        <a className="banks-source" data-testid="banks-source-link" href={tab.source} target="_blank" rel="noopener noreferrer">Source ↗</a>
      )}
      {tab.snapshot && <span className="banks-meta" data-testid="banks-snapshot">Snapshot {tab.snapshot}</span>}
    </header>
  )
}
