/** AI.md "3-block stepped loader"; static under reduced motion. */
export function BlockLoader({ label, testId }: { label: string; testId?: string }) {
  return (
    <span className="ds-loader" role="status" aria-label={label} data-testid={testId}>
      <i /><i /><i />
    </span>
  )
}
