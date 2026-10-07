import { READ_ONLY_MESSAGE } from '../data/writer'

/** Addendum 3: shown in a browser without the writer token. */
export function ReadOnlyBanner({ readOnly }: { readOnly: boolean }) {
  if (!readOnly) return null
  return <p className="readonly-banner" role="status" data-testid="readonly-banner">{READ_ONLY_MESSAGE}</p>
}
