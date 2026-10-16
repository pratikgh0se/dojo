import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { askPathSearch, globalKeyBlocked, isPaletteKey, modalOpen } from '../rules/keyScope'
import { DESTINATIONS } from '../rules/nav'

/**
 * 1 to 6 go to the first six destinations, ? opens the shortcuts, Ctrl or Cmd K the palette (also from inside a text field).
 * The digits and ? never fire inside a text field, an editor, the design canvas or any `[data-no-global-keys]` zone, with a
 * modifier, while an overlay is open, or behind another open dialog. The canvas owns its own `?` (the design session's
 * `session-keys`). Navigation is immediate (R18): the key switches the screen in the same event, it never waits for a write.
 */
export function useGlobalKeys(a: { overlayOpen: boolean; onPalette: () => void; onShortcuts: () => void }): void {
  const navigate = useNavigate()
  const { overlayOpen, onPalette, onShortcuts } = a
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isPaletteKey(e)) {
        if (e.defaultPrevented || e.isComposing) return
        e.preventDefault()
        onPalette()
        return
      }
      if (overlayOpen || globalKeyBlocked(e) || modalOpen()) return
      if (e.key === '?') { e.preventDefault(); onShortcuts(); return }
      // PATH-10: Path's own "/" handler is registered after its first paint, and the box can be drawn before that, so the shell
      // focuses a drawn box itself; while the box is not drawn yet it keeps the press for Path
      if (e.key === '/' && window.location.pathname === '/path') {
        e.preventDefault()
        const box = document.querySelector<HTMLInputElement>('[data-testid="path-search"]')
        if (box) box.focus(); else askPathSearch()
        return
      }
      const dest = DESTINATIONS.find(x => x.key === e.key)
      if (dest) { e.preventDefault(); navigate(dest.to) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, overlayOpen, onPalette, onShortcuts])
}
