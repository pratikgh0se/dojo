import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AutosaveStatus } from '../../src/screens/designSession/AutosaveStatus'
import { useWriteQueue } from '../../src/screens/designSession/useWriteQueue'

const named = (name: string) => Object.assign(new Error(name), { name })

describe('useWriteQueue savedAt (DESIGN-15: Autosaved only after a write that landed)', () => {
  it('stamps savedAt after a write that lands', async () => {
    const onError = vi.fn()
    const { result } = renderHook(() => useWriteQueue(onError))
    expect(result.current.savedAt).toBeNull()
    act(() => result.current.push(async () => true))
    await waitFor(() => expect(result.current.savedAt).not.toBeNull())
    expect(onError).not.toHaveBeenCalled()
  })

  it.each([
    ['a quota error', () => Promise.reject(named('QuotaExceededError'))],
    ['a read-only error', () => Promise.reject(named('ReadOnlyError'))],
    ['a generic error', () => Promise.reject(new Error('boom'))],
  ])('never stamps savedAt after %s, and says so', async (_label, job) => {
    const onError = vi.fn()
    const { result } = renderHook(() => useWriteQueue(onError))
    act(() => result.current.push(job))
    await act(async () => { await result.current.flush() })
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    expect(result.current.savedAt).toBeNull()
  })

  it('does not stamp savedAt when the job result is exactly false (a guarded write that did nothing)', async () => {
    const onError = vi.fn()
    const { result } = renderHook(() => useWriteQueue(onError))
    act(() => result.current.push(async () => false))
    await act(async () => { await result.current.flush() })
    expect(result.current.savedAt).toBeNull()
    expect(onError).not.toHaveBeenCalled()
  })

  it('a failure after a success keeps the earlier stamp and the status never reads a new Autosaved time for it', async () => {
    const onError = vi.fn()
    const { result } = renderHook(() => useWriteQueue(onError))
    act(() => result.current.push(async () => true))
    await waitFor(() => expect(result.current.savedAt).not.toBeNull())
    const first = result.current.savedAt
    await new Promise(r => setTimeout(r, 5))
    act(() => result.current.push(() => Promise.reject(named('QuotaExceededError'))))
    await act(async () => { await result.current.flush() })
    expect(result.current.savedAt).toBe(first)
  })

  it('AutosaveStatus keeps reading "Autosave on" when the first write failed', async () => {
    function Probe({ job }: { job: () => Promise<unknown> }) {
      const { push, savedAt } = useWriteQueue(() => {})
      return (
        <>
          <button onClick={() => push(job)}>go</button>
          <AutosaveStatus savedAt={savedAt} />
        </>
      )
    }
    render(<Probe job={() => Promise.reject(named('QuotaExceededError'))} />)
    act(() => screen.getByRole('button', { name: 'go' }).click())
    await new Promise(r => setTimeout(r, 30))
    expect(screen.getByTestId('session-autosave')).toHaveTextContent('Autosave on')
    expect(screen.getByTestId('session-autosave')).not.toHaveTextContent(/Autosaved/)
  })
})

describe('useWriteQueue coalescing (DESIGN-16: no debounce, but never one transaction per keystroke)', () => {
  const deferred = () => {
    let release!: () => void
    const p = new Promise<void>(r => { release = r })
    return { p, release }
  }

  it('a burst of keyed pushes runs at most one running plus one pending job, and the last snapshot is the one stored', async () => {
    const { result } = renderHook(() => useWriteQueue(vi.fn()))
    const stored: number[] = []
    const gate = deferred()
    act(() => {
      result.current.push(async () => { await gate.p; stored.push(0) }, 'notes')
      for (let i = 1; i <= 50; i++) result.current.push(async () => { stored.push(i) }, 'notes')
    })
    gate.release()
    await act(async () => { await result.current.flush() })
    expect(stored.length).toBeLessThanOrEqual(2)
    expect(stored.at(-1)).toBe(50)
  })

  it('keys do not coalesce with each other or with unkeyed jobs, and order per key is kept', async () => {
    const { result } = renderHook(() => useWriteQueue(vi.fn()))
    const log: string[] = []
    act(() => {
      result.current.push(async () => { log.push('plain1') })
      result.current.push(async () => { log.push('notes1') }, 'notes')
      result.current.push(async () => { log.push('canvas1') }, 'canvas')
      result.current.push(async () => { log.push('plain2') })
      result.current.push(async () => { log.push('notes2') }, 'notes')
    })
    await act(async () => { await result.current.flush() })
    expect(log).toEqual(['plain1', 'notes2', 'canvas1', 'plain2'])
  })

  it('flushNow starts the newest pending snapshot at once, without waiting behind the running job', async () => {
    const { result } = renderHook(() => useWriteQueue(vi.fn()))
    const gate = deferred()
    const started: string[] = []
    act(() => {
      result.current.push(async () => { started.push('running'); await gate.p }, 'notes')
    })
    await waitFor(() => expect(started).toEqual(['running']))
    act(() => {
      result.current.push(async () => { started.push('old') }, 'notes')
      result.current.push(async () => { started.push('newest') }, 'notes')
    })
    expect(started).toEqual(['running'])
    act(() => result.current.flushNow()) // synchronous: the request must be issued inside the pagehide handler
    expect(started).toEqual(['running', 'newest'])
    gate.release()
    await act(async () => { await result.current.flush() })
    expect(started).toEqual(['running', 'newest']) // the forced snapshot is not written a second time
  })

  it('flushNow re-issues the running snapshot when nothing newer is pending (its read-modify-write may be cut off)', async () => {
    const { result } = renderHook(() => useWriteQueue(vi.fn()))
    const gate = deferred()
    const started: string[] = []
    act(() => { result.current.push(async () => { started.push('running'); await gate.p }, 'notes') })
    await waitFor(() => expect(started).toEqual(['running']))
    act(() => result.current.flushNow())
    expect(started).toEqual(['running', 'running'])
    gate.release()
    await act(async () => { await result.current.flush() })
  })
})
