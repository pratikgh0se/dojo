import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AI_ERRORS } from '../../src/ai/types'
import { AiError, AiLoader, aiHeading } from '../../src/ui/ai/AiStates'
import { Drawer } from '../../src/ui/Drawer'
import { ToastProvider, useToast } from '../../src/ui/primitives'

describe('AI states', () => {
  it('loader is a status named "Asking the helper…" with three blocks', () => {
    render(<AiLoader />)
    const l = screen.getByRole('status', { name: 'Asking the helper…' })
    expect(l).toHaveAttribute('data-testid', 'ai-loader')
    expect(l.querySelectorAll('i')).toHaveLength(3)
  })

  it('error shows the C-LADDER §6 heading, the raw detail and a Retry button', () => {
    const onRetry = vi.fn()
    render(<AiError failure={{ code: 'claude_missing', message: 'fake hint unavailable' }} onRetry={onRetry} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Claude Code is not installed or not on PATH.')
    expect(screen.getByTestId('ai-error-detail').textContent).toBe('claude_missing: fake hint unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('ruling 20 S7: a known code shows only the friendly line; its raw detail waits behind Details', () => {
    for (const code of ['claude_signed_out', 'claude_missing', 'helper_unreachable']) {
      const { unmount } = render(<AiError failure={{ code, message: 'claude is not signed in: Not logged in · Please run /login' }} onRetry={() => {}} />)
      const more = screen.getByTestId('ai-error-more')
      expect(more.tagName).toBe('DETAILS')
      expect(more).not.toHaveAttribute('open')
      expect(more.querySelector('summary')).toHaveTextContent('Details')
      expect(more).toContainElement(screen.getByTestId('ai-error-detail'))
      unmount()
    }
    render(<AiError failure={{ code: 'claude_failed', message: 'boom' }} onRetry={() => {}} />)
    expect(screen.queryByTestId('ai-error-more')).toBeNull()
    expect(screen.getByTestId('ai-error-detail')).toHaveTextContent('claude_failed: boom')
  })

  it('H-46 every code has its heading; unknown codes fall back to claude_failed', () => {
    expect(aiHeading('helper_unreachable')).toBe('The AI helper is not running. Start it with npm run helper.')
    expect(aiHeading('timeout')).toBe('The AI helper timed out.')
    expect(aiHeading('claude_failed')).toBe('The AI helper failed.')
    expect(aiHeading('busy')).toBe('The AI helper is busy. Try again in a moment.')
    expect(aiHeading('invalid_output')).toBe('The AI returned something unusable.')
    expect(aiHeading('guardrail')).toBe('That request is not allowed before you give up.')
    for (const c of ['bad_request', 'path_not_allowed', 'unknown_job']) expect(aiHeading(c)).toBe('The AI helper rejected the request.')
    expect(aiHeading('weird')).toBe('The AI helper failed.')
    // M2: a 413 too_large reads as a clear, actionable message, not the generic claude_failed one.
    expect(aiHeading('too_large')).toBe("The AI helper rejected it: too long. Shorten it and retry.")
  })

  it('every real AiErrorCode has a heading equal to its foundation message', () => {
    for (const code of Object.keys(AI_ERRORS)) expect(aiHeading(code)).toBe(AI_ERRORS[code as keyof typeof AI_ERRORS].message)
  })
})

describe('Toast tone', () => {
  it('carries data-tone, including help', () => {
    function Push() {
      const t = useToast()
      return <button onClick={() => { t('+8 xp · Saved', 'help'); t('+10 xp · Saved') }}>go</button>
    }
    render(<ToastProvider><Push /></ToastProvider>)
    fireEvent.click(screen.getByText('go'))
    const toasts = screen.getAllByTestId('toast')
    expect(toasts.map(t => t.getAttribute('data-tone'))).toEqual(['help', 'ok'])
    expect(toasts[0]).toHaveClass('tone-help')
  })
})

describe('Drawer test ids', () => {
  it('accepts a custom root and toggle test id', () => {
    render(<Drawer id="redo" testId="today-redo-drawer" toggleTestId="today-redo-toggle" title="Redo · 1" sub="" cubes={[false]} done={0} total={1} tone="rival" open={false} onToggle={() => {}}>x</Drawer>)
    expect(screen.getByTestId('today-redo-drawer')).toBeInTheDocument()
    expect(screen.getByTestId('today-redo-toggle')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('today-redo-toggle')).toHaveAccessibleName(/Redo · 1/)
  })
  it('keeps drawer-{id} by default', () => {
    render(<Drawer id="dsa" title="DSA" sub="" cubes={[]} done={0} total={0} tone="rival" open={false} onToggle={() => {}}>x</Drawer>)
    expect(screen.getByTestId('drawer-dsa')).toBeInTheDocument()
  })
})
