import { useEffect, useState } from 'react'

/** The phone breakpoint (ui-foundation F4: phone is < 768 px). */
export const NARROW_QUERY = '(max-width: 767px)'

const read = (query: string): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches

/** True while the media query matches. Always false where matchMedia is missing (jsdom). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => read(query))
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(query)
    const sync = () => setMatches(mql.matches)
    sync()
    mql.addEventListener('change', sync)
    return () => mql.removeEventListener('change', sync)
  }, [query])
  return matches
}
