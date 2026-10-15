import { READ_ONLY_MESSAGE } from '../data/writer'

/** Addendum 3: shown in a browser without the writer token (or, with `message`, when the data is from a newer Dojo). */
export function ReadOnlyBanner({ readOnly, message = READ_ONLY_MESSAGE }: { readOnly: boolean; message?: string }) {
  if (!readOnly) return null
  return <p className="readonly-banner" role="status" data-testid="readonly-banner">{message}</p>
}
