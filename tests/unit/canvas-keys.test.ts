import { describe, expect, it } from 'vitest'
import { canvasAction } from '../../src/screens/designSession/kit/canvasKeys'

const k = (key: string, o: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) =>
  canvasAction({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o })
describe('canvasAction', () => {
  it('maps the plain keys', () => {
    expect([k('n'), k('c'), k('t'), k('g'), k('?')]).toEqual(['add-note', 'add-custom', 'add-table', 'group', 'help'])
  })
  it('Shift+G (also a capital G) ungroups', () => {
    expect(k('G', { shiftKey: true })).toBe('ungroup')
    expect(k('g', { shiftKey: true })).toBe('ungroup')
  })
  it('ignores modified keys, digits and everything else (1 to 4 never switch destinations from here)', () => {
    expect(k('n', { ctrlKey: true })).toBeNull()
    expect(k('c', { metaKey: true })).toBeNull()
    for (const key of ['1', '2', '3', '4', 'l', 'Delete', 'ArrowLeft', 'a']) expect(k(key)).toBeNull()
  })
})
