import { renderHook } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { usePointerEditing } from '../../src/screens/designSession/kit/pointer'

/** A canvas whose border box starts at (0,0) with a 2px border, like `.kit-canvas` in kit.css. */
function fakeCanvas(): HTMLDivElement {
  const el = document.createElement('div')
  el.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 960, bottom: 576, width: 960, height: 576, x: 0, y: 0, toJSON() {} }) as DOMRect
  Object.defineProperty(el, 'clientLeft', { value: 2 })
  Object.defineProperty(el, 'clientTop', { value: 2 })
  Object.defineProperty(el, 'scrollLeft', { value: 0 })
  Object.defineProperty(el, 'scrollTop', { value: 0 })
  return el
}

function setup() {
  const canvasRef = createRef<HTMLDivElement>() as { current: HTMLDivElement | null }
  ;(canvasRef as { current: HTMLDivElement }).current = fakeCanvas()
  const { result } = renderHook(() =>
    usePointerEditing({
      locked: false,
      enabled: true,
      canvasRef,
      onMove: vi.fn(),
      onSelect: vi.fn(),
      onLinkStart: vi.fn(),
      onLinkEnd: vi.fn(),
    }),
  )
  return result
}

describe('cellAt (D-13): drop position snaps to the cell under the pointer', () => {
  it('floors a canvas offset of exactly 240 to cell 10, matching the contract', () => {
    const result = setup()
    expect(result.current.cellAt(240, 240)).toEqual({ x: 10, y: 10 })
  })

  it('snaps just-below and just-above a grid boundary to the same neighboring cells', () => {
    const result = setup()
    expect(result.current.cellAt(239, 239)).toEqual({ x: 9, y: 9 })
    expect(result.current.cellAt(241, 241)).toEqual({ x: 10, y: 10 })
  })
})
