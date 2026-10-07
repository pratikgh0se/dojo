import './projects.css'

/** AI.md UI contract: a 3-block stepped loader. */
export function StepLoader({ label, testId }: { label: string; testId?: string }) {
  return (
    <span className="p-loader" role="status" aria-label={label} data-testid={testId}>
      <i /><i /><i />
      <span className="p-loader-text">{label}</span>
    </span>
  )
}
