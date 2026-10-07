// C-RUNNER §4 / C-PYTHON §1: the code panel on Do for a ticket with a problem pack: the language switch
// (Go on the server, Python in the browser), the editor (saved per language as he types, ≤ 1 s debounce,
// through the normal outbox path), Run (the two examples) and Submit (all five), the status, the cases with
// their diffs, compile/runtime errors, his prints and the DP view.
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useDb } from '../app/providers'
import { chooseLang, codeRows, lastLang, saveCode, type Lang } from '../data/codeActions'
import { safeWrite } from '../data/safeWrite'
import { isReadOnly, READ_ONLY_MESSAGE } from '../data/writer'
import { now } from '../lib/clock'
import { Button, Panel, useToast } from '../ui/primitives'
import { fetchPack, NO_SERVER_MESSAGE, runCode } from './client'
import { hasSteps } from './dpModel'
import { StepsBoundary } from './StepsBoundary'
import { pyClient } from './py/pyClient'
import { pySignature, pyStarter } from './py/starters'
import { diffText, errorText, LOADING_PYTHON_TEXT, passesGate, RUNNING_TEXT, SLOW_GO_RUN_TEXT, SLOW_RUN_MS, statusText, stdoutText, TRUNCATED_TEXT } from './status'
import type { PublicPack, RunMode, RunResult } from './types'
import './runner.css'

const CodeEditor = lazy(() => import('./CodeEditor'))
const DpView = lazy(() => import('./DpView'))
export const SAVE_DEBOUNCE_MS = 500
const LANGS: { lang: Lang; label: string }[] = [{ lang: 'go', label: 'Go' }, { lang: 'py', label: 'Python' }]

/** The text a language's editor opens with when nothing is saved: the pack's starter. */
const starterFor = (pack: PublicPack, lang: Lang): string | null => (lang === 'go' ? pack.starter : pyStarter(pack))

/** One panel per ticket: moving to another ticket remounts it, so nothing typed or run for one shows under the next. */
export function CodePanel(props: { ticketId: string; onSubmitPassed: () => void }) {
  return <CodePanelFor key={props.ticketId} {...props} />
}

function CodePanelFor({ ticketId, onSubmitPassed }: { ticketId: string; onSubmitPassed: () => void }) {
  const d = useDb()
  const toast = useToast()
  const [pack, setPack] = useState<PublicPack | null | 'missing'>(null)
  const rows = useLiveQuery(() => codeRows(d, ticketId), [d, ticketId])
  // The language is the one he picked in this visit, else the ticket's last-written row (C-PYTHON §4).
  const [picked, setPicked] = useState<Lang | null>(null)
  const lang: Lang | null = picked ?? (rows ? lastLang(rows) : null)
  // What he typed this visit, per language; until then the saved row, else the starter.
  const [typed, setTyped] = useState<Partial<Record<Lang, string>>>({})
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; text: string; lang: Lang } | null>(null)
  const [running, setRunning] = useState(false)
  const [phase, setPhase] = useState<'loading' | 'running'>('running')
  // cu-4 P3-17: a Go run still going after SLOW_RUN_MS says why it can take a few seconds (the build cache is cold)
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (!running) { setSlow(false); return }
    const t = setTimeout(() => setSlow(true), SLOW_RUN_MS)
    return () => clearTimeout(t)
  }, [running])
  // `code` is what the run was given: once the editor holds something else the results are stale (UAT J4).
  // UAT cu-4 P3-6: each language keeps the result of its own last run, so Go, Python and back brings Go's result back; a result
  // is only ever shown beside the editor whose code produced it.
  type Run = { r: RunResult; mode: RunMode; n: number; code: string }
  const [results, setResults] = useState<Partial<Record<Lang, Run>>>({})
  const result: Run | null = lang === null ? null : results[lang] ?? null
  const [message, setMessage] = useState('')
  const runs = useRef(0)
  // L4: what a run was asked for. A result is shown (and may open the gate) only if the panel is still on that
  // ticket and language when it arrives.
  const live = useRef({ lang: null as Lang | null, mounted: true })
  live.current.lang = lang
  useEffect(() => { live.current.mounted = true; return () => { live.current.mounted = false } }, [])

  useEffect(() => {
    let live = true
    void fetchPack(ticketId).then(p => { if (live) setPack(p ?? 'missing') })
    return () => { live = false }
  }, [ticketId])

  const readyPack = pack !== null && pack !== 'missing' ? pack : null
  const savedFor = (l: Lang) => rows?.find(r => r.lang === l)?.source
  const source: string | null = lang === null || readyPack === null || rows === undefined
    ? null
    : typed[lang] ?? savedFor(lang) ?? starterFor(readyPack, lang)

  const flush = () => {
    const p = pending.current
    if (!p) return
    clearTimeout(p.timer)
    pending.current = null
    void safeWrite(() => saveCode(d, ticketId, p.text, now(), p.lang), m => toast(m, 'danger'))
  }
  useEffect(() => flush, []) // eslint-disable-line react-hooks/exhaustive-deps
  // M8: a pending save is written at once when the page hides (tab switch, close, navigation away),
  // not only when the debounce fires, which may never happen once the page is gone.
  const flushRef = useRef(flush)
  flushRef.current = flush
  useEffect(() => {
    const onHide = () => flushRef.current()
    const onVisibility = () => { if (document.visibilityState === 'hidden') flushRef.current() }
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  const onChange = (text: string) => {
    if (lang === null) return
    setTyped(t => ({ ...t, [lang]: text }))
    if (isReadOnly()) return
    if (pending.current) clearTimeout(pending.current.timer)
    pending.current = { text, lang, timer: setTimeout(flush, SAVE_DEBOUNCE_MS) }
  }

  function pick(next: Lang) {
    if (next === lang || readyPack === null) return
    flush()
    setPicked(next)
    setMessage('')
    const starter = starterFor(readyPack, next)
    if (!isReadOnly() && starter !== null) void safeWrite(() => chooseLang(d, ticketId, next, starter, now()), m => toast(m, 'danger'))
  }

  async function go(mode: RunMode) {
    // PY-13 / RN-12: a read-only browser is refused before anything starts: no request, no runtime.
    if (isReadOnly()) {
      toast(READ_ONLY_MESSAGE, 'danger')
      return
    }
    if (running || source === null || readyPack === null || lang === null) return
    flush()
    setRunning(true)
    setMessage('')
    const asked = lang
    const code = source
    let out
    if (lang === 'py') {
      const client = pyClient()
      setPhase(client.everReady ? 'running' : 'loading')
      out = await client.run({ pack: readyPack, code: source, mode }, {
        onLoading: () => { if (!client.everReady) setPhase('loading') },
        onRunning: () => setPhase('running'),
      })
    } else {
      out = await runCode({ pack: ticketId, code: source, mode })
    }
    if (!live.current.mounted) return
    setRunning(false)
    if (live.current.lang !== asked) return // he moved to the other language meanwhile: this answer is not for what is on screen
    if (!out.ok) {
      setResults(rs => ({ ...rs, [asked]: undefined }))
      setMessage(out.message)
      return
    }
    runs.current += 1
    setResults(rs => ({ ...rs, [asked]: { r: out.result, mode, n: runs.current, code } }))
    if (passesGate(out.result, mode)) onSubmitPassed()
  }

  const r = result?.r
  const stale = !running && result !== null && source !== null && source !== result.code
  // M3: a diff only for a case that actually ran (and returned) in a run that ran its cases; after a
  // compile error, a timeout or a limit the calls are listed without "got nothing" diffs.
  const ran = (c: RunResult['cases'][number]) => (r?.status === 'ok' || r?.status === 'runtime_error') && c.got !== null && c.got !== undefined
  const status = running ? (lang === 'py' && phase === 'loading' ? LOADING_PYTHON_TEXT : lang === 'go' && slow ? SLOW_GO_RUN_TEXT : RUNNING_TEXT) : r ? statusText(r) : message
  return (
    <>
    <Panel title="Code" className="code-panel" data-testid="code-panel">
      {/* ui-do D5: the editor side (7fr) and the results side (5fr) from 1100 px; one column below */}
      <div className="code-grid">
      <div className="code-side">
      {readyPack !== null && lang !== null && (
        <div className="lang-switch" role="radiogroup" aria-label="Language" data-testid="lang-switch">
          {LANGS.map(o => (
            <label key={o.lang} className="lang-option" data-checked={lang === o.lang ? 'true' : 'false'}>
              <input type="radio" name={`lang-${ticketId}`} value={o.lang} checked={lang === o.lang} onChange={() => pick(o.lang)} />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      )}
      {readyPack !== null && lang !== null && <p className="code-sig" data-testid="code-sig"><code>{lang === 'py' ? pySignature(readyPack) ?? readyPack.signature : readyPack.signature}</code></p>}
      {pack === 'missing' && <p className="code-note">{NO_SERVER_MESSAGE}</p>}
      {source !== null && lang !== null && (
        <Suspense fallback={<p className="code-note">Loading the editor…</p>}>
          <CodeEditor key={lang} value={source} onChange={onChange} lang={lang} />
        </Suspense>
      )}
      <div className="run-bar">
        <Button onClick={() => void go('run')} disabled={running}>Run</Button>
        <Button variant="accent" onClick={() => void go('submit')} disabled={running}>Submit</Button>
        <span className="run-status" data-testid="run-status" role="status" data-status={running ? 'running' : r?.status ?? ''} data-tone={statusTone(running, r, message)} data-stale={stale ? 'true' : undefined}>{status}</span>
      </div>
      </div>
      <div className="code-results" data-running={running ? 'true' : undefined} data-stale={stale ? 'true' : undefined}>
      <h3 className="code-h3">Cases</h3>
      {stale && <p className="run-stale" data-testid="run-stale">Code changed since this run. Run it again to check.</p>}
      {readyPack !== null && !r && (
        <ul className="run-examples" aria-label="Examples">
          {readyPack.cases.slice(0, readyPack.examples).map(c => <li key={c.id}><code>{c.call}</code> → <code>{JSON.stringify(c.expected)}</code></li>)}
        </ul>
      )}
      {r && r.cases.length > 0 && (
        <ol className="run-cases" aria-label="Cases">
          {r.cases.map((c, i) => (
            <li key={c.id} className="run-case" data-testid={`run-case-${i + 1}`} data-pass={c.pass ? 'true' : 'false'}>
              {/* cu-4 P3-19: the mark and the text are two flex items, so a long call wraps beside its mark, never leaving it alone above */}
              <span className="run-case-mark" aria-hidden="true">{c.pass ? '✓' : ran(c) ? '✗' : '·'}</span>{' '}
              <span className="run-case-body">
                <code>{c.call}</code>
                {c.pass
                  ? <span className="run-case-val"> → {JSON.stringify(c.got)}</span>
                  : ran(c)
                    ? <><span className="run-case-val"> → {JSON.stringify(c.got)}</span><p className="run-diff" data-testid="run-diff">{diffText(c)}</p></>
                    : <span className="run-case-val run-case-skipped"> → expected {JSON.stringify(c.expected)} (not run)</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
      {r && r.errors.length > 0 && (
        <ul className="run-errors" aria-label="Errors">
          {r.errors.map((e, i) => <li key={i} className="run-error" data-testid="run-error">{errorText(e)}</li>)}
        </ul>
      )}
      {r && stdoutText(r.stdout) !== '' && <h3 className="code-h3">Output</h3>}
      {r && <pre className="run-stdout sc" data-testid="run-stdout" aria-label="Output">{stdoutText(r.stdout)}</pre>}
      {r?.truncated && <p className="run-truncated" data-testid="run-truncated">{TRUNCATED_TEXT}</p>}
      </div>
      </div>
    </Panel>
    {/* ui-do D6: the trace is a panel of its own, the next workbench row, not nested in the code panel */}
    {/* perf diagnostic P2 + UAT J4: a run (passing or failing) with no dojo/tk calls draws no trace; say how to get one */}
    {r && r.status === 'ok' && !hasSteps(r.steps) && (
      <p className="code-note trace-hint" data-testid="trace-hint">No trace yet: call tk.Table / tk.Set in your solution to see the DP picture.</p>
    )}
    {r && hasSteps(r.steps) && (
      <StepsBoundary key={result?.n}>
        <Suspense fallback={<p className="code-note">Loading the trace…</p>}>
          <DpView key={result?.n} steps={r.steps} caseCalls={Object.fromEntries(r.cases.map(c => [c.id, c.call]))} />
        </Suspense>
      </StepsBoundary>
    )}
    </>
  )
}

/** ui-do D5: run-status colour: passed ok, failures danger, running and no-toolchain warn. */
function statusTone(running: boolean, r: RunResult | undefined, message: string): string {
  if (running) return 'warn'
  const status = r?.status
  if (status === 'ok') return r!.cases.every(c => c.pass) ? 'ok' : 'danger'
  if (status === 'no_toolchain') return 'warn'
  if (status) return 'danger'
  return message ? 'warn' : ''
}
