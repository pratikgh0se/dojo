import { useEffect, useRef, useState } from 'react'
import type { PagesInfo } from '../../data/portfolioClient'
import type { PortfolioItem } from '../../data/types'
import type { OutputKind } from '../../rules/portfolioDrafts'
import { Button } from '../../ui/primitives'

export const PAGES_TEXT = {
  enabled: 'GitHub Pages is now on for this repository. GitHub takes about a minute to show a new page.',
  on: 'GitHub Pages is already on for this repository.',
  failed: 'Your page is published, but GitHub Pages could not be turned on. To turn it on by hand, open the repository Settings, choose Pages, pick branch main and the root folder, and save. Then open the page.',
}

export const OUTPUTS: { kind: OutputKind; label: string }[] = [
  { kind: 'repo', label: 'Public lab repo' },
  { kind: 'site', label: 'Portfolio site page' },
  { kind: 'article', label: 'Article draft' },
  { kind: 'linkedin', label: 'LinkedIn post draft' },
]
const statusWord = (kind: OutputKind, s: 'none' | 'draft' | 'published'): string =>
  s === 'none' ? 'Not started' : s === 'draft' ? 'Draft' : kind === 'linkedin' ? 'Posted' : 'Published'

export interface OutputRowProps {
  labId: string
  kind: OutputKind
  item: PortfolioItem | undefined
  readOnly: boolean
  creating: boolean
  error: { code: string; message: string } | null
  /** the Pages result of the publish just made (site, article); not stored */
  pages?: PagesInfo
  onCreate: () => void
  onType: (text: string) => void
  onPublish: () => void
  onCopy: (text: string) => void
  onPosted: () => void
}

/** One output of a lab (PORT-04 to PORT-19): its status, the text area once there is a draft (or a failed one), and the buttons. */
export function OutputRow(p: OutputRowProps) {
  const def = OUTPUTS.find(o => o.kind === p.kind)!
  const key = `${p.labId}-${p.kind}`
  const status = p.item ? p.item.status : 'none'
  const stored = p.item?.draft ?? ''
  const [text, setText] = useState(stored)
  const box = useRef<HTMLTextAreaElement>(null)
  // a change from outside (Create draft just stored a text) shows at once; while the learner is typing the box keeps what they typed
  useEffect(() => { if (document.activeElement !== box.current) setText(stored) }, [stored])
  const published = status === 'published'
  const hasText = text.trim() !== ''
  const showBox = p.item !== undefined || p.error !== null
  const ai = p.kind === 'article' || p.kind === 'linkedin'
  return (
    <li className="pf-out" data-testid={`portfolio-out-${key}`} data-status={status} data-kind={p.kind}>
      <div className="pf-out-head">
        <h3 className="pf-out-title" data-testid={`portfolio-label-${key}`}>{def.label}</h3>
        <span className="pf-chip" data-testid={`portfolio-status-${key}`}>{statusWord(p.kind, status)}</span>
      </div>
      {published && p.item?.url && <a className="pf-link" data-testid={`portfolio-url-${key}`} href={p.item.url} target="_blank" rel="noreferrer">{p.item.url}</a>}
      {published && p.pages && (
        <div className="pf-pages" data-testid={`portfolio-pages-${key}`} data-pages={p.pages.state}>
          {p.pages.state === 'failed' ? (
            <>
              <p className="pf-warn" role="alert" data-testid={`portfolio-pages-error-${key}`}>{PAGES_TEXT.failed}</p>
              <p className="pf-mono" data-testid={`portfolio-pages-detail-${key}`} data-content="learner">{p.pages.detail}</p>
            </>
          ) : (
            <>
              <p className="pf-line" data-testid={`portfolio-pages-text-${key}`}>{PAGES_TEXT[p.pages.state]}</p>
              <a className="pf-link pf-site-url" data-testid={`portfolio-site-url-${key}`} href={p.pages.siteUrl} target="_blank" rel="noreferrer">{p.pages.siteUrl}</a>
            </>
          )}
        </div>
      )}
      {showBox && (
        <textarea
          ref={box} className="pf-text" data-testid={`portfolio-text-${key}`} data-content="learner" rows={p.kind === 'linkedin' ? 8 : 12}
          aria-label={`${def.label}, text`} value={text} readOnly={published || p.readOnly}
          onChange={e => { setText(e.target.value); p.onType(e.target.value) }}
        />
      )}
      {p.error && !hasText && (
        <p className="pf-warn" role="alert" data-testid={`portfolio-draft-error-${key}`} data-code={p.error.code}>{p.error.message}</p>
      )}
      <div className="pf-actions">
        {!hasText && !published && !p.error && (
          <Button data-testid={`portfolio-create-${key}`} disabled={p.creating || p.readOnly} onClick={p.onCreate}>Create draft</Button>
        )}
        {!hasText && !published && p.error && (
          <Button data-testid={`portfolio-retry-${key}`} disabled={p.creating || p.readOnly} onClick={p.onCreate}>Retry</Button>
        )}
        {p.kind !== 'linkedin' && p.item && !published && hasText && (
          <Button data-testid={`portfolio-publish-${key}`} disabled={p.readOnly} onClick={p.onPublish}>Publish</Button>
        )}
        {ai && p.item && (
          <Button variant="quiet" data-testid={`portfolio-copy-${key}`} disabled={!hasText} onClick={() => p.onCopy(text)}>Copy</Button>
        )}
        {p.kind === 'linkedin' && p.item && !published && (
          <Button variant="quiet" data-testid={`portfolio-posted-${p.labId}-linkedin`} disabled={p.readOnly || !hasText} onClick={p.onPosted}>Mark as posted</Button>
        )}
      </div>
    </li>
  )
}
