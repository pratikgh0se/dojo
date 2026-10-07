/** The System Design Kit vocabulary, copied from the frozen lab/diagram.js (FAM, LK). A unit test keeps it in sync. */
export const KIT_FAMILIES: readonly { family: string; kinds: readonly string[] }[] = [
  { family: 'client', kinds: ['browser', 'phone', 'desktop', 'cli', 'human'] },
  { family: 'edge', kinds: ['cdn', 'dns', 'gateway', 'lb', 'webhook'] },
  { family: 'compute', kinds: ['service', 'function', 'worker', 'cron', 'process'] },
  { family: 'data', kinds: ['sql', 'nosql', 'vector', 'search', 'storage', 'fs', 'table', 'doc'] },
  { family: 'messaging', kinds: ['queue', 'stream'] },
  { family: 'cache', kinds: ['cache'] },
  { family: 'security', kinds: ['auth', 'secrets', 'config'] },
  { family: 'observe', kinds: ['monitor'] },
  { family: 'ai', kinds: ['llm', 'agent', 'gpu'] },
  { family: 'external', kinds: ['external'] },
  { family: 'flow', kinds: ['state', 'start', 'end', 'decision'] },
]

export const KIT_KINDS: readonly string[] = KIT_FAMILIES.flatMap(f => f.kinds)

export const LINK_KINDS = [
  'sync', 'async', 'stream', 'batch', 'replication', 'cacheHit', 'cacheMiss', 'retry', 'timeout', 'failover', 'talk', 'read', 'write',
] as const
export type LinkKind = (typeof LINK_KINDS)[number]
export const DEFAULT_LINK_KIND: LinkKind = 'sync'

/** diagram.js: 24 px grid, 24 px padding, 112×88 node box before label widening. */
export const KIT_GRID = 24
export const KIT_PAD = 24
export const KIT_NODE_W = 112
export const KIT_NODE_H = 88
