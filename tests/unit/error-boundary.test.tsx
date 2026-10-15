import { Suspense, lazy } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from '../../src/app/ErrorBoundary'

function Boom(): never {
  throw new Error('boom')
}

describe('ErrorBoundary (README top-level fallback, MIG-01)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('renders screen-error, with one calm sentence, when a child throws while rendering', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<ErrorBoundary><Boom /></ErrorBoundary>)
    const e = screen.getByTestId('screen-error')
    expect(screen.getByTestId('fatal')).toContainElement(e)
    expect(screen.getByTestId('fatal')).toHaveAttribute('role', 'alert')
    expect(e).toHaveTextContent('Something went wrong')
    expect(e).toHaveTextContent('Your work is saved. Reload to continue.')
    expect(log).toHaveBeenCalled() // the crash is logged, not swallowed
  })

  it('renders screen-error as a section when a lazy chunk fails to load (rejected import)', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const Chunk = lazy(() => Promise.reject(new Error('Failed to fetch dynamically imported module')))
    render(<ErrorBoundary><Suspense fallback={<p>loading</p>}><Chunk /></Suspense></ErrorBoundary>)
    const e = await waitFor(() => screen.getByTestId('screen-error'))
    expect(e.tagName).toBe('SECTION')
    expect(e).toHaveTextContent('Something went wrong')
    expect(screen.getByTestId('fatal')).toHaveAttribute('role', 'alert')
    expect(log).toHaveBeenCalled()
  })

  it('renders its children and no screen-error when nothing throws', () => {
    render(<ErrorBoundary><p>fine</p></ErrorBoundary>)
    expect(screen.getByText('fine')).toBeInTheDocument()
    expect(screen.queryByTestId('screen-error')).toBeNull()
  })

  it('is mounted in main.tsx, around App, and not in App.tsx', async () => {
    const { readFileSync } = await import('node:fs')
    expect(readFileSync('src/main.tsx', 'utf8')).toMatch(/<ErrorBoundary><App /)
    expect(readFileSync('src/app/App.tsx', 'utf8')).not.toMatch(/ErrorBoundary/)
  })
})
