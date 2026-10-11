/** Plan links like "#bank" name a screen inside the app (the old index.html tabs), not a web page. */
const HOMES: Record<string, string> = {
  overview: '/overview', tree: '/map', plan: '/map', bank: '/dsa', dbank: '/designs', ai: '/ai', mentors: '/mentors', ritual: '/ritual',
}

/** The in-app route a plan link points at, or null when it is an ordinary external URL. */
export function appRoute(url: string): string | null {
  if (!url.startsWith('#')) return null
  return HOMES[url.slice(1)] ?? null
}
