import type { DiagramDiff } from '../../rules/designDiff'

function DiffList({ title, items, testId }: { title: string; items: string[]; testId: string }) {
  return (
    <div className="ds-diff-col">
      <h3 className="ds-sub">{title}</h3>
      <ul data-testid={testId} className="ds-diff-list">
        {items.length === 0
          ? <li className="empty">None</li>
          : items.map((t, i) => <li key={i} data-testid="session-diff-item">{t}</li>)}
      </ul>
    </div>
  )
}

/** TRACKING §1: the diff is information, not a score. */
export function DiffPanel({ diff }: { diff: DiagramDiff }) {
  return (
    <section className="sr-panel ds-diff" data-testid="session-diff" aria-label="Differences">
      <h2 className="sr-panel-title">Differences</h2>
      <p className="hint">Information, not a score.</p>
      <div className="ds-diff-cols">
        <DiffList title="Only in yours" items={diff.mine} testId="session-diff-mine" />
        <DiffList title="Only in reference" items={diff.ref} testId="session-diff-ref" />
        <DiffList title="Different link kinds" items={diff.links} testId="session-diff-links" />
      </div>
    </section>
  )
}
