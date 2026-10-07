export function isLocalHost(hostname: string): boolean
export function linkVerdict(raw: string): 'open' | 'confirm' | 'refuse'
export const ALLOWED_PERMISSIONS: Set<string>
export function permissionAllowed(permission: string, requestingUrl: string, appOrigin: string): boolean
