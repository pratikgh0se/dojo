// C-PYTHON §1/§4/§5: the Language switch, Python runs, per-language storage and the gate, in the code panel.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { codeRows, saveCode } from '../../src/data/codeActions'
import { setNow } from '../../src/lib/clock'
import { CodePanel, SAVE_DEBOUNCE_MS } from '../../src/runner/CodePanel'
import { stdoutText as stdoutShown } from '../../src/runner/status'
import type { PyHooks } from '../../src/runner/py/pyClient'
import type { PublicPack, RunResult } from '../../src/runner/types'
import { seededDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

vi.mock('../../src/runner/CodeEditor', () => ({
  default: ({ value, onChange, lang }: { value: string; onChange: (s: string) => void; lang?: string }) => (
    <textarea aria-label="Code" data-lang={lang ?? 'go'} value={value} onChange={e => onChange(e.target.value)} />
  ),
}))

const py = vi.hoisted(() => ({
  everReady: false,
  calls: [] as { pack: string; code: string; mode: string }[],
  next: null as null | ((hooks: PyHooks) => Promise<unknown>),
  created: 0,
}))
vi.mock('../../src/runner/py/pyClient', () => ({
  pyClient: () => {
    py.created += 1
    return {
      get everReady() { return py.everReady },
      run: async (req: { pack: { id: string }; code: string; mode: string }, hooks: PyHooks = {}) => {
        py.calls.push({ pack: req.pack.id, code: req.code, mode: req.mode })
        return py.next!(hooks)
      },
      dispose() {},
    }
  },
}))

const PACK: PublicPack = {
  id: 'p91', title: 'Decode Ways', fn: 'numDecodings', signature: 'func numDecodings(s string) int',
  starter: 'package main\n\n// numDecodings returns how many ways the digit string s decodes.\n//\n// Optional: x\nfunc numDecodings(s string) int {\n\treturn 0\n}\n', examples: 2,
  cases: [
    { id: 1, call: 'numDecodings("12")', expected: 2 }, { id: 2, call: 'numDecodings("226")', expected: 3 }, { id: 3, call: 'numDecodings("06")', expected: 0 },
    { id: 4, call: 'numDecodings("11106")', expected: 2 }, { id: 5, call: 'numDecodings("2611055971756562")', expected: 4 },
  ],
}
const T = new Date('2026-09-08T21:10:00+05:30').getTime()
const result = (n: number, pass = true, extra: Partial<RunResult> = {}): RunResult => ({
  status: 'ok', errors: [], stdout: '', steps: [], truncated: false, ms: 1,
  cases: PACK.cases.slice(0, n).map(c => ({ id: c.id, call: c.call, expected: c.expected, got: pass ? c.expected : 99, pass })), ...extra,
})

let fetches: string[] = []
beforeEach(() => {
  setNow(() => T)
  py.everReady = false
  py.calls = []
  py.created = 0
  py.next = async () => ({ ok: true, result: result(2) })
  fetches = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    fetches.push(String(url))
    return String(url).startsWith('/tools/packs/') ? new Response(JSON.stringify(PACK), { status: 200 }) : new Response('{}', { status: 404 })
  }))
})
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

async function panel(opts: { before?: (d: Awaited<ReturnType<typeof seededDb>>) => Promise<void> } = {}) {
  const d = await seededDb()
  await opts.before?.(d)
  const onPass = vi.fn()
  const view = renderWithApp(<CodePanel ticketId="p91" onSubmitPassed={onPass} />, { db: d, plan: smallPlan })
  await screen.findByRole('textbox', { name: 'Code' })
  return { d, onPass, view }
}
const radio = (name: string) => screen.getByRole('radio', { name })
const editor = () => screen.getByRole('textbox', { name: 'Code' }) as HTMLTextAreaElement
const status = () => screen.getByTestId('run-status')

describe('the Language switch', () => {
  it('is a radio group named Language with Go and Python, Go by default, showing the Go signature', async () => {
    await panel()
    const group = screen.getByRole('radiogroup', { name: 'Language' })
    expect(group).toBeInTheDocument()
    expect(screen.getAllByRole('radio').map(r => r.getAttribute('aria-label') ?? (r as HTMLInputElement).labels?.[0]?.textContent)).toEqual(['Go', 'Python'])
    expect(radio('Go')).toBeChecked()
    expect(radio('Python')).not.toBeChecked()
    expect(screen.getByText('func numDecodings(s string) int')).toBeInTheDocument()
    expect(editor().dataset.lang).toBe('go')
    expect(editor().value).toContain('package main')
  })

  it('Python shows the Python signature and starter, and remembers the choice as lastLang in the code row', async () => {
    const { d } = await panel()
    fireEvent.click(radio('Python'))
    await waitFor(() => expect(editor().value).toContain('def numDecodings(s: str) -> int:'))
    expect(editor().dataset.lang).toBe('py')
    expect(screen.getByText('def numDecodings(s: str) -> int:')).toBeInTheDocument()
    expect(screen.queryByText('func numDecodings(s string) int')).toBeNull()
    expect(radio('Python')).toBeChecked()
    await waitFor(async () => expect((await codeRows(d, 'p91')).find(r => r.lang === 'py')).toMatchObject({ lang: 'py', lastLang: true }))
    expect(py.created).toBe(0) // choosing Python starts nothing
    expect(fetches.filter(u => !u.startsWith('/tools/packs/'))).toEqual([])
  })

  it('PY-10: each language keeps its own typed source, and the panel reopens on the last-chosen language', async () => {
    const { d, view } = await panel()
    fireEvent.change(editor(), { target: { value: 'package main // my go' } })
    fireEvent.click(radio('Python'))
    await waitFor(() => expect(editor().value).toContain('def numDecodings'))
    fireEvent.change(editor(), { target: { value: 'def numDecodings(s):\n    return 7  # my py\n' } })
    window.dispatchEvent(new Event('pagehide'))
    await waitFor(async () => expect((await codeRows(d, 'p91')).map(r => [r.lang, r.source, !!r.lastLang])).toEqual([
      ['go', 'package main // my go', false], ['py', 'def numDecodings(s):\n    return 7  # my py\n', true],
    ]))
    view.unmount()
    renderWithApp(<CodePanel ticketId="p91" onSubmitPassed={() => {}} />, { db: d, plan: smallPlan })
    await waitFor(() => expect(editor().value).toContain('# my py'))
    expect(radio('Python')).toBeChecked()
    fireEvent.click(radio('Go'))
    await waitFor(() => expect(editor().value).toBe('package main // my go'))
    expect(radio('Go')).toBeChecked()
  })

  it('a legacy 4a row (no lastLang) opens on Go, unchanged', async () => {
    const { d } = await panel({ before: async d => { await d.code.put({ ticketId: 'p91', lang: 'go', source: 'package main // 4a', updatedAt: 5 }) } })
    expect(editor().value).toBe('package main // 4a')
    expect(radio('Go')).toBeChecked()
    expect(await d.code.get(['p91', 'go'])).toEqual({ ticketId: 'p91', lang: 'go', source: 'package main // 4a', updatedAt: 5 })
  })

  it('opens on Python when the last row written was Python', async () => {
    await panel({ before: async d => { await saveCode(d, 'p91', 'package main', 1, 'go'); await saveCode(d, 'p91', 'def numDecodings(s):\n    pass\n', 2, 'py') } })
    expect(radio('Python')).toBeChecked()
    expect(editor().value).toBe('def numDecodings(s):\n    pass\n')
  })

  it('saves are debounced to at most 1 s (and not before he stops typing)', async () => {
    expect(SAVE_DEBOUNCE_MS).toBeLessThanOrEqual(1000)
    const { d } = await panel()
    fireEvent.click(radio('Python'))
    await waitFor(() => expect(editor().value).toContain('def numDecodings'))
    const want = 'def numDecodings(s):\n    return 1\n'
    const t0 = Date.now()
    fireEvent.change(editor(), { target: { value: want } })
    expect((await d.code.get(['p91', 'py']))?.source).not.toBe(want)
    await waitFor(async () => expect((await d.code.get(['p91', 'py']))?.source).toBe(want), { timeout: 1000 })
    expect(Date.now() - t0).toBeLessThan(1000)
  })
})

describe('Python runs', () => {
  async function pyPanel() {
    const p = await panel()
    fireEvent.click(radio('Python'))
    await waitFor(() => expect(editor().value).toContain('def numDecodings'))
    return p
  }

  it('Run sends the Python code and mode to the in-browser runner, never to /tools/run-go', async () => {
    await pyPanel()
    fireEvent.change(editor(), { target: { value: 'def numDecodings(s):\n    return 2\n' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(status()).toHaveTextContent('Passed 2/2'))
    expect(py.calls).toEqual([{ pack: 'p91', code: 'def numDecodings(s):\n    return 2\n', mode: 'run' }])
    expect(fetches.some(u => u.includes('/tools/run-go'))).toBe(false)
    expect(screen.getAllByTestId(/^run-case-/)).toHaveLength(2)
  })

  it('PY-01: a Python Submit with 5/5 opens the gate', async () => {
    py.next = async () => ({ ok: true, result: result(5) })
    const { onPass } = await pyPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(status()).toHaveTextContent('Passed 5/5'))
    expect(onPass).toHaveBeenCalledTimes(1)
    expect(py.calls[0].mode).toBe('submit')
  })

  it('a Python Run, or a failing Submit, never opens the gate', async () => {
    const { onPass } = await pyPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(status()).toHaveTextContent('Passed 2/2'))
    py.next = async () => ({ ok: true, result: result(5, false) })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(status()).toHaveTextContent('Failed 0/5'))
    expect(onPass).not.toHaveBeenCalled()
  })

  it('PY-02: a wrong answer shows the diff', async () => {
    py.next = async () => ({ ok: true, result: { ...result(2), cases: [{ ...result(2).cases[0] }, { id: 2, call: 'numDecodings("226")', expected: 3, got: 4, pass: false }] } })
    await pyPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(status()).toHaveTextContent('Failed 1/2'))
    expect(screen.getByTestId('run-diff')).toHaveTextContent('numDecodings("226"): expected 3, got 4')
  })

  it('PY-03/PY-04: compile and runtime errors show their lines', async () => {
    await pyPanel()
    py.next = async () => ({ ok: true, result: { ...result(2, false), status: 'compile_error', errors: [{ line: 3, col: 5, message: 'invalid syntax' }], cases: result(2).cases.map(c => ({ ...c, got: null, pass: false })) } })
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(status()).toHaveTextContent('Compile error'))
    expect(screen.getByTestId('run-error')).toHaveTextContent('line 3: invalid syntax')
    py.next = async () => ({ ok: true, result: { ...result(2, false), status: 'runtime_error', errors: [{ line: 2, col: 0, message: 'ValueError: boom' }], cases: result(2).cases.map(c => ({ ...c, got: null, pass: false })) } })
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(status()).toHaveTextContent('Runtime error'))
    expect(screen.getByTestId('run-error')).toHaveTextContent('line 2: ValueError: boom')
  })

  it('the limit statuses read as in Go', async () => {
    await pyPanel()
    for (const [st, text] of [['timeout', 'Timed out after 3 s'], ['output_limit', 'Output too large'], ['memory_limit', 'Out of memory']] as const) {
      py.next = async () => ({ ok: true, result: { ...result(2, false), status: st, cases: result(2).cases.map(c => ({ ...c, got: null, pass: false })) } })
      fireEvent.click(screen.getByRole('button', { name: 'Run' }))
      await waitFor(() => expect(status()).toHaveTextContent(text))
    }
  })

  it('PY-11: the first run says "Loading Python…" until the runtime is running the code, later runs say "Running…"', async () => {
    let release: () => void = () => {}
    py.next = hooks => new Promise(ok => {
      hooks.onLoading?.()
      release = () => { hooks.onRunning?.(); py.everReady = true; ok({ ok: true, result: result(2) }) }
    })
    await pyPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(status()).toHaveTextContent('Loading Python…'))
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
    await act(async () => release())
    await waitFor(() => expect(status()).toHaveTextContent('Passed 2/2'))
    // the second run never says Loading, even if the frame reports loading again (a fresh worker after a timeout)
    py.next = hooks => new Promise(ok => { hooks.onLoading?.(); release = () => ok({ ok: true, result: result(2) }) })
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(status()).toHaveTextContent('Running…'))
    await act(async () => release())
    await waitFor(() => expect(status()).toHaveTextContent('Passed 2/2'))
  })

  it('a runner that cannot start shows its message and no result', async () => {
    py.next = async () => ({ ok: false, message: 'Python could not start. Reload Dojo and try again.' })
    await pyPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(status()).toHaveTextContent('Python could not start. Reload Dojo and try again.'))
    expect(screen.queryAllByTestId(/^run-case-/)).toHaveLength(0)
  })

  it('shows the DP view for Python steps, like Go', async () => {
    py.next = async () => ({ ok: true, result: result(2, true, { steps: [{ op: 'table', t: 0, rows: 1, cols: 3, name: 'dp', case: 1 }, { op: 'set', t: 0, i: 0, j: 1, v: 1, deps: [] }] }) })
    await pyPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    expect(await screen.findByTestId('dp-view')).toBeInTheDocument()
    expect(screen.getByTestId('dp-step-counter')).toHaveTextContent('Step 2 / 2')
  })

  it('switching language shows only that language\'s own result, and brings it back on the way back (UAT cu-4 P3-6)', async () => {
    await pyPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(status()).toHaveTextContent('Passed 2/2'))
    fireEvent.click(radio('Go'))
    await waitFor(() => expect(status()).toHaveTextContent('')) // Go has not run: nothing of Python's is shown beside Go's code
    expect(screen.queryAllByTestId(/^run-case-/)).toHaveLength(0)
    fireEvent.click(radio('Python'))
    await waitFor(() => expect(status()).toHaveTextContent('Passed 2/2')) // and Python's own result is still there
    expect(screen.getAllByTestId(/^run-case-/)).toHaveLength(2)
  })
})

describe('PY-13: a read-only browser', () => {
  it('a Python Run or Submit shows the Read-only toast and never starts the runtime', async () => {
    localStorage.removeItem('dojo.writer')
    const d = await seededDb()
    renderWithApp(<CodePanel ticketId="p91" onSubmitPassed={() => {}} />, { db: d, plan: smallPlan })
    await screen.findByRole('textbox', { name: 'Code' })
    fireEvent.click(radio('Python'))
    await waitFor(() => expect(editor().value).toContain('def numDecodings'))
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    expect((await screen.findAllByTestId('toast'))[0]).toHaveTextContent(/^Read-only/)
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(py.created).toBe(0)
    expect(py.calls).toEqual([])
    expect(await d.code.count()).toBe(0) // and a read-only browser wrote nothing
  })
})

describe('L4: a result lands only where it was asked for', () => {
  async function started() {
    let release: (v: unknown) => void = () => {}
    py.next = () => new Promise(ok => { release = ok })
    const { onPass, view, d } = await panel()
    fireEvent.click(radio('Python'))
    await waitFor(() => expect(editor().value).toContain('def numDecodings'))
    return { onPass, view, d, release: (v: unknown) => release(v) }
  }

  it('a Python result that arrives after switching to Go is dropped: no result, no gate', async () => {
    const { onPass, release } = await started()
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(screen.getByTestId('run-status')).toHaveTextContent(/Loading Python|Running/))
    fireEvent.click(radio('Go'))
    await act(async () => release({ ok: true, result: result(5) }))
    expect(screen.queryAllByTestId(/^run-case-/)).toHaveLength(0)
    expect(status()).not.toHaveTextContent('Passed')
    expect(onPass).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Run' })).toBeEnabled()
  })

  it('a result that arrives after the ticket changed opens no gate', async () => {
    const { onPass, release, view } = await started()
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(screen.getByTestId('run-status')).toHaveTextContent(/Loading Python|Running/))
    view.unmount()
    await act(async () => release({ ok: true, result: result(5) }))
    expect(onPass).not.toHaveBeenCalled()
  })

  it('moving the same panel to another ticket starts clean (no typed text or result from the first)', async () => {
    const d = await seededDb()
    const onPass = vi.fn()
    function Switch() {
      const [id, setId] = useState('p91')
      return <><button onClick={() => setId('p198')}>other</button><CodePanel ticketId={id} onSubmitPassed={onPass} /></>
    }
    renderWithApp(<Switch />, { db: d, plan: smallPlan })
    await screen.findByRole('textbox', { name: 'Code' })
    fireEvent.change(editor(), { target: { value: 'package main // only for p91' } })
    fireEvent.click(screen.getByRole('button', { name: 'other' }))
    await waitFor(() => expect(editor().value).not.toContain('only for p91'))
  })
})

describe('python.md Addendum 2 Q2: run-stdout', () => {
  it('cuts at 64 KiB with a marker, and leaves short or empty output alone', () => {
    expect(stdoutShown('')).toBe('')
    expect(stdoutShown('hi\n')).toBe('hi\n')
    expect(stdoutShown('x'.repeat(65536))).toBe('x'.repeat(65536))
    const cut = stdoutShown('x'.repeat(65537))
    expect(cut.startsWith('x'.repeat(65536))).toBe(true)
    expect(cut.endsWith('… (output truncated)')).toBe(true)
    expect(cut.length).toBeLessThan(65536 + 40)
  })

  it('is a pre after every run: the program\'s prints (Go or Python), empty when nothing was printed', async () => {
    py.next = async () => ({ ok: true, result: result(2, true, { stdout: 'hello\n' }) })
    await panel()
    fireEvent.click(radio('Python'))
    await waitFor(() => expect(editor().value).toContain('def numDecodings'))
    expect(screen.queryByTestId('run-stdout')).toBeNull() // before any run
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(status()).toHaveTextContent('Passed 2/2'))
    expect(screen.getByTestId('run-stdout').tagName).toBe('PRE')
    expect(screen.getByTestId('run-stdout')).toHaveTextContent('hello')
    py.next = async () => ({ ok: true, result: result(2) })
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(screen.getByTestId('run-stdout')).toBeEmptyDOMElement())
    // Go too (through /tools/run-go)
    fireEvent.click(radio('Go'))
    vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url).startsWith('/tools/packs/')
      ? new Response(JSON.stringify(PACK), { status: 200 })
      : new Response(JSON.stringify(result(2, true, { stdout: 'go says hi\n' })), { status: 200 })))
    await waitFor(() => expect(radio('Go')).toBeChecked())
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(screen.getByTestId('run-stdout')).toHaveTextContent('go says hi'))
  })
})
