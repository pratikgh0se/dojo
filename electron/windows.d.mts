export function isOwnUrl(u: string, appUrl: string): boolean
export function isPartnerCardUrl(u: string, appUrl: string): boolean
export function windowOpenDecision(u: string, appUrl: string, opts?: { allowCard?: boolean }): 'card' | 'deny' | 'outside'
