/** Current value of a CSS custom property on <html>, or '' where styles are absent (jsdom). */
export function cssVar(name: string): string {
  if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') return ''
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}
