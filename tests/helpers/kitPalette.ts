import { fireEvent, screen } from '@testing-library/react'
import { KIT_FAMILIES } from '../../src/content/diagramKit'

/** Opens the family of `kind` (when it is not open) and returns the kind's tile: a tile is only on screen while its family's flyout is open (DESIGN-23a). */
export function openTile(kind: string): HTMLElement {
  const family = KIT_FAMILIES.find(f => f.kinds.includes(kind))!.family
  const btn = screen.getByTestId(`kit-family-${family}`)
  if (btn.getAttribute('aria-expanded') !== 'true') fireEvent.click(btn)
  return screen.getByTestId(`kit-tile-${kind}`)
}

/** Adds a node of `kind` the way a user does: open its family, click its tile (which closes the flyout). */
export function addKind(kind: string): void {
  fireEvent.click(openTile(kind))
}
