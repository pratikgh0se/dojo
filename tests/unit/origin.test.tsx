import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { noteScreen, resetOrigin, useLeaveDo } from '../../src/app/origin'

function Leave() {
  const leave = useLeaveDo()
  const loc = useLocation()
  return <><button onClick={leave}>back</button><span data-testid="at">{loc.pathname}</span></>
}

describe('useLeaveDo (TICKET-01)', () => {
  beforeEach(() => { resetOrigin(); window.history.replaceState(null, '') })

  it('goes to Today when the ticket was opened directly in a fresh tab', () => {
    render(<MemoryRouter initialEntries={['/do/a']}><Leave /></MemoryRouter>)
    fireEvent.click(screen.getByText('back'))
    expect(screen.getByTestId('at')).toHaveTextContent('/')
    expect(screen.getByTestId('at').textContent).toBe('/')
  })

  it('goes to the screen noted before, also after the page was loaded afresh (the module forgot it, the tab did not)', () => {
    noteScreen('/path')
    // a fresh page load: the in-memory origin is gone, sessionStorage keeps it
    const kept = sessionStorage.getItem('dojo-origin')
    expect(kept).toContain('/path')
    resetOrigin()
    sessionStorage.setItem('dojo-origin', kept!)
    render(<MemoryRouter initialEntries={['/do/a']}><Leave /></MemoryRouter>)
    fireEvent.click(screen.getByText('back'))
    expect(screen.getByTestId('at').textContent).toBe('/path')
  })

  it('a stored origin restores its path even when the fresh document has a later history index (reload, Start pushes the same URL, Back)', () => {
    // the origin was noted in an earlier document at idx 0; this document's Start pushed a duplicate entry, so its idx is 1
    sessionStorage.setItem('dojo-origin', JSON.stringify({ path: '/', idx: 0 }))
    window.history.replaceState({ idx: 1 }, '')
    render(<MemoryRouter initialEntries={['/do/a', '/do/a']} initialIndex={1}><Leave /></MemoryRouter>)
    fireEvent.click(screen.getByText('back'))
    expect(screen.getByTestId('at').textContent).toBe('/')
  })

  it('the remembered /path wins over a stale index after a full load of /do/<id>', () => {
    sessionStorage.setItem('dojo-origin', JSON.stringify({ path: '/path', idx: 0 }))
    window.history.replaceState({ idx: 2 }, '')
    render(<MemoryRouter initialEntries={['/do/a', '/do/a', '/do/a']} initialIndex={2}><Leave /></MemoryRouter>)
    fireEvent.click(screen.getByText('back'))
    expect(screen.getByTestId('at').textContent).toBe('/path')
  })

  it('goes to Today in a fresh tab with nothing stored', () => {
    expect(sessionStorage.getItem('dojo-origin')).toBeNull()
    render(<MemoryRouter initialEntries={['/do/a']}><Leave /></MemoryRouter>)
    fireEvent.click(screen.getByText('back'))
    expect(screen.getByTestId('at').textContent).toBe('/')
  })
})
