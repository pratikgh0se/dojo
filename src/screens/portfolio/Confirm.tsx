import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { ExportInfo, LeakHit, PublishKind } from '../../data/portfolioClient'
import { Button } from '../../ui/primitives'

export interface ConfirmState {
  kind: PublishKind
  /** null while the export is being built, or when it failed (then `error` says why) */
  info: ExportInfo | null
  /** the draft text that will be published (also what the export was built from) */
  text: string
  error: { code: string; message: string } | null
  /** hits the publish route found when it scanned again (they replace the export's) */
  hits: LeakHit[] | null
  busy: boolean
}

export const PAGES_NOTE = 'First time: turn on GitHub Pages once. In the repository Settings, open Pages and choose branch main and the root folder. Dojo does not change repository settings.'
export const DIRTY_NOTE = 'Uncommitted changes in the lab folder are not included.'
const LEAK_REPO = 'Something in these files should not go public. Fix it in the lab folder, commit it, and publish again.'
const LEAK_PAGE = 'Something in this text should not go public. Fix the text, then publish again.'
const LABEL: Record<PublishKind, string> = { repo: 'REPO', site: 'SITE', article: 'ARTICLE' }
const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** What stops Publish before any click: a leak in the files, or a GitHub CLI problem. */
function blockingError(s: ConfirmState): { code: string; message: string } | null {
  const hits = s.hits ?? s.info?.hits ?? []
  if (hits.length > 0) return { code: 'leak_found', message: s.kind === 'repo' ? LEAK_REPO : LEAK_PAGE }
  if (s.info && !s.info.gh.ok) return { code: s.info.gh.code, message: s.info.gh.message }
  return null
}
/** The error the dialog shows: the last publish's (it does not block another try, PORT-43), the export's own, or a blocking one. */
export const confirmError = (s: ConfirmState): { code: string; message: string } | null => s.error ?? blockingError(s)

/**
 * The confirm screen (PORT-20 to PORT-32, PORT-49): every file the publish writes, the exact URL, any leak-scan hit, then the one
 * Publish button. It is a modal dialog: Tab stays inside, Esc and Cancel close it. Nothing public happens before the button.
 */
export function Confirm({ state, pagesNote, onSubmit, onCancel }: { state: ConfirmState; pagesNote: boolean; onSubmit: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const before = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  useEffect(() => { ref.current?.focus() }, [])
  const close = () => { if (state.busy) return; onCancel(); queueMicrotask(() => before.current?.focus()) }
  const { info } = state
  const hits = state.hits ?? info?.hits ?? []
  const error = confirmError(state)
  const url = info?.urls[0]
  const owner = info?.gh.ok ? `${info.gh.user}/` : ''
  const blocked = state.busy || !info || blockingError(state) !== null || info.publishFiles.length === 0
  return createPortal(
    <div className="pf-back" onMouseDown={e => { if (e.target === e.currentTarget) close() }}>
      <div
        ref={ref} tabIndex={-1} className="sr-panel pf-dialog" role="dialog" aria-modal="true" aria-labelledby="pf-dialog-title" data-testid="portfolio-confirm"
        onKeyDown={e => {
          e.stopPropagation()
          if (e.key === 'Escape') { e.preventDefault(); close() }
          else if (e.key === 'Tab') {
            const f = Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
            const first = f[0]
            const last = f[f.length - 1]
            const at = document.activeElement
            if (!first) e.preventDefault()
            else if (e.shiftKey && (at === first || at === ref.current)) { e.preventDefault(); last.focus() }
            else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus() }
          }
        }}
      >
        <h2 className="pf-dialog-title" id="pf-dialog-title">Confirm publish</h2>
        {!info && !error && <p className="pf-note" role="status">Checking the files…</p>}
        {info && (
          <>
            <p className="pf-line">Publishing to <span className="pf-mono" data-testid="portfolio-confirm-repo">{owner}{info.repo}</span></p>
            {url && <p className="pf-line">It will be public at <span className="pf-mono pf-url" data-testid="portfolio-confirm-url">{url}</span></p>}
            <h3 className="pf-cap">Files</h3>
            <ul className="pf-files" data-testid="portfolio-confirm-files" data-count={info.publishFiles.length}>
              {info.publishFiles.map((p, i) => <li key={p} data-testid={`portfolio-confirm-file-${i + 1}`}>{p}</li>)}
            </ul>
            {state.kind === 'repo' && info.uncommitted && <p className="pf-note" data-testid="portfolio-confirm-dirty">{DIRTY_NOTE}</p>}
            {state.kind !== 'repo' && pagesNote && <p className="pf-note" data-testid="portfolio-confirm-pages-note">{PAGES_NOTE}</p>}
          </>
        )}
        {hits.length > 0 && (
          <div>
            <h3 className="pf-cap">Found in the files</h3>
            <ul className="pf-hits" data-testid="portfolio-confirm-hits" data-count={hits.length}>
              {hits.map((h, i) => (
                <li key={`${h.file}:${h.line}:${h.rule}:${i}`} data-testid={`portfolio-hit-${i + 1}`} data-file={h.file} data-line={h.line} data-rule={h.rule}>
                  <span className="pf-mono" data-testid={`portfolio-hit-file-${i + 1}`}>{h.file}</span>
                  <span className="pf-mono" data-testid={`portfolio-hit-line-${i + 1}`}>{h.line}</span>
                  <span className="pf-mono" data-testid={`portfolio-hit-rule-${i + 1}`}>{h.rule}</span>
                  <span className="pf-mono" data-testid={`portfolio-hit-text-${i + 1}`} data-content="learner">{h.text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {error && (
          <div className="pf-warn" role="alert" data-testid="portfolio-confirm-error" data-code={error.code}>
            <p className="pf-error-text" data-testid="portfolio-confirm-error-message">{error.message}</p>
          </div>
        )}
        <div className="pf-actions">
          {/* GLOBAL-03: no control of the action group follows the accent button in tab order, so Cancel comes first (PORT-49). */}
          <Button variant="quiet" data-testid="portfolio-confirm-cancel" disabled={state.busy} onClick={close}>Cancel</Button>
          <Button variant="accent" data-accent="primary" data-testid="portfolio-confirm-submit" disabled={blocked} onClick={onSubmit}>
            {state.busy ? 'PUBLISHING…' : `PUBLISH · ${LABEL[state.kind]}`}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
