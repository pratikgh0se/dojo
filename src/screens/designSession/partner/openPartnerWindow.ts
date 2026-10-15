export type Opener = (url: string, target: string, features: string) => Window | null
export const PARTNER_WINDOW_FEATURES = 'popup=yes,width=560,height=800'

const state = new Map<string, 'opened' | 'blocked'>()

export const partnerUrl = (origin: string, sessionId: string): string => `${origin}/#/partner/${sessionId}`

/** The card in a second window (A2). A blocked window (null or a throw) falls back to the Partner tab. window.open is read at call time. */
export function openPartnerWindow(sessionId: string, opener: Opener = (u, t, f) => window.open(u, t, f)): 'opened' | 'blocked' {
  let w: Window | null = null
  try { w = opener(partnerUrl(window.location.origin, sessionId), `dojo-partner-${sessionId}`, PARTNER_WINDOW_FEATURES) } catch { w = null }
  const result = w ? 'opened' : 'blocked'
  state.set(sessionId, result)
  return result
}
export const partnerWindowState = (sessionId: string): 'opened' | 'blocked' | null => state.get(sessionId) ?? null
