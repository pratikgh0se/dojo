export type CanvasAction = 'add-note' | 'add-custom' | 'add-table' | 'group' | 'ungroup' | 'help'
type KeyEvent = { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }

/** Canvas-focus shortcuts of design session v2. Anything with Ctrl, Cmd or Alt, and every other key, is not ours. */
export function canvasAction(e: KeyEvent): CanvasAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null
  const k = e.key.toLowerCase()
  if (k === 'n') return 'add-note'
  if (k === 'c') return 'add-custom'
  if (k === 't') return 'add-table'
  if (k === 'g') return e.shiftKey ? 'ungroup' : 'group'
  if (e.key === '?') return 'help'
  return null
}
