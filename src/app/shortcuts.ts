import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useNavigateAfterWrites } from '../data/useNavigateAfterWrites'
import { isTypingTarget } from '../lib/keys'
import { isFullScreenPath, TABS } from './tabs'

export const MORE_KEY = 'm'

export const SHORTCUT_ROUTES: Record<string, string> = {
  ...Object.fromEntries(TABS.filter(t => t.key !== null).map(t => [t.key as string, t.to])),
  t: '/',
}

export function useShortcuts(onMore?: () => void): void {
  const go = useNavigateAfterWrites()
  const loc = useLocation()
  const onDo = isFullScreenPath(loc.pathname)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (onDo || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
      if (isTypingTarget(e.target)) return
      if (e.key === MORE_KEY) {
        if (!onMore) return
        e.preventDefault()
        onMore()
        return
      }
      const to = SHORTCUT_ROUTES[e.key]
      if (!to) return
      e.preventDefault()
      go(to)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, onDo, onMore])
}
