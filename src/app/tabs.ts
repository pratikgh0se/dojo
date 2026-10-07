export type TabGroup = 'primary' | 'more'

export interface TabDef {
  to: string
  label: string
  /** single-key shortcut, or null for menu-only tabs */
  key: string | null
  group: TabGroup
}

export const TABS: readonly TabDef[] = [
  { to: '/', label: 'Today', key: '1', group: 'primary' },
  { to: '/board', label: 'Board', key: '2', group: 'primary' },
  { to: '/dsa', label: 'DSA', key: '3', group: 'primary' },
  { to: '/designs', label: 'Designs', key: '4', group: 'primary' },
  { to: '/ai', label: 'AI', key: '5', group: 'primary' },
  { to: '/map', label: 'Map', key: '6', group: 'more' },
  { to: '/progress', label: 'Progress', key: '7', group: 'more' },
  { to: '/week', label: 'Week', key: '8', group: 'more' },
  { to: '/overview', label: 'Overview', key: '9', group: 'more' },
  { to: '/atlas', label: 'Atlas', key: 'a', group: 'more' },
  { to: '/banks', label: 'Banks', key: 'b', group: 'more' },
  { to: '/mentors', label: 'Mentors', key: null, group: 'more' },
  { to: '/ritual', label: 'Ritual', key: null, group: 'more' },
  { to: '/settings', label: 'Settings', key: '0', group: 'more' },
]

export const PRIMARY_TABS: readonly TabDef[] = TABS.filter(t => t.group === 'primary')
export const MORE_TABS: readonly TabDef[] = TABS.filter(t => t.group === 'more')

/** ui-shell S1/S2: below 768 px the nav keeps Today, Board and DSA; Designs and AI move to the top of More. */
export const PHONE_MORE_PATHS: readonly string[] = ['/designs', '/ai']
export const isPhoneMoreTab = (t: TabDef) => PHONE_MORE_PATHS.includes(t.to)

export function tabForPath(pathname: string): TabDef | undefined {
  return TABS.find(t => (t.to === '/' ? pathname === '/' : pathname === t.to || pathname.startsWith(`${t.to}/`)))
}

/** Work routes that hide the header, the footer legend and the global tab shortcuts. */
export const FULLSCREEN_PREFIXES = ['/do/', '/designs/session/'] as const

export function isFullScreenPath(pathname: string): boolean {
  return FULLSCREEN_PREFIXES.some(p => pathname.startsWith(p))
}
