/** Plan links like "#bank" name a screen inside the app (the old index.html tabs), not a web page. The screens behind #overview, #mentors and #ritual are gone; they land on the Guide, and the tree, plan and ai anchors on Skills. */
const HOMES: Record<string, string> = {
  overview: '/guide', mentors: '/guide', ritual: '/guide', tree: '/skills', plan: '/skills', ai: '/skills', bank: '/dsa', dbank: '/designs',
}

/** The in-app route a plan link points at, or null when it is an ordinary external URL. */
export function appRoute(url: string): string | null {
  if (!url.startsWith('#')) return null
  return HOMES[url.slice(1)] ?? null
}
