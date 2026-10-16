/**
 * UAT cu-4 P3-4: what a link check result means. 2xx and 3xx are ok. A host that answers 401, 403 or 429 (or LinkedIn's 999)
 * is alive and turning the automatic check away (a bot wall: leetcode.com answers every non-browser request 403), so the link
 * is "can't verify", never "broken". Anything else that is not ok (404, 410, 5xx, no answer at all) is broken.
 */
export type LinkVerdict = 'ok' | 'unverified' | 'broken'
const REFUSES_THE_CHECK = new Set([401, 403, 429, 999])
export function linkVerdict(r: { ok: boolean; status: number }): LinkVerdict {
  if (r.ok) return 'ok'
  return REFUSES_THE_CHECK.has(r.status) ? 'unverified' : 'broken'
}
export const LINK_UNVERIFIED_HINT = 'The site refused the automatic check, so the link is not confirmed broken. Open it to see.'
