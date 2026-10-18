import { useEffect, useRef, useState } from 'react'
import { useDb } from '../../app/providers'
import { fetchLabInfo } from '../../data/labActions'
import { createDraft, markPublished, saveDraft } from '../../data/portfolioActions'
import { exportLab, publishLab, type PagesInfo, type PublishKind } from '../../data/portfolioClient'
import { safeWrite } from '../../data/safeWrite'
import type { LabRow, PortfolioItem } from '../../data/types'
import { now } from '../../lib/clock'
import type { OutputKind } from '../../rules/portfolioDrafts'
import { Loading } from '../../ui/Loading'
import { useToast } from '../../ui/primitives'
import { Confirm, type ConfirmState } from './Confirm'
import { OUTPUTS, OutputRow } from './OutputRow'

/** The lab's title from the server's definition (GET /labs/info): null until it has answered, then the title, or the id when it cannot be read (read-only). The card is not drawn before that. */
function useLabTitle(labId: string): string | null {
  const [title, setTitle] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setTitle(null)
    void fetchLabInfo(labId).then(i => { if (live) setTitle(i?.title || labId) })
    return () => { live = false }
  }, [labId])
  return title
}

export interface LabCardProps { lab: LabRow; items: PortfolioItem[]; pagesPublished: boolean; readOnly: boolean }

/** One Proven lab with its four outputs and, while one is being published, the confirm screen. */
export function LabCard({ lab, items, pagesPublished, readOnly }: LabCardProps) {
  const d = useDb()
  const toast = useToast()
  const title = useLabTitle(lab.labId)
  const [creating, setCreating] = useState<ReadonlySet<OutputKind>>(new Set())
  const inFlight = useRef(new Set<OutputKind>()) // set synchronously, so a second quick press does nothing
  const [errors, setErrors] = useState<Partial<Record<OutputKind, { code: string; message: string }>>>({})
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [pages, setPages] = useState<Partial<Record<OutputKind, PagesInfo>>>({}) // the Pages result of this visit's publishes: shown, never stored (R3)
  const item = (k: OutputKind) => items.find(i => i.kind === k)
  const write = <T,>(fn: () => Promise<T>) => safeWrite(fn, m => toast(m, 'danger'))
  const setError = (k: OutputKind, e: { code: string; message: string } | null) => setErrors(prev => ({ ...prev, [k]: e ?? undefined }))

  async function create(kind: OutputKind) {
    if (inFlight.current.has(kind)) return
    inFlight.current.add(kind)
    setCreating(new Set(inFlight.current))
    setError(kind, null)
    try {
      const r = await write(() => createDraft(d, lab.labId, kind, now()))
      if (r && !r.ok) setError(kind, { code: r.code, message: r.message })
    } finally {
      inFlight.current.delete(kind)
      setCreating(new Set(inFlight.current))
    }
  }

  async function open(kind: PublishKind) {
    const text = item(kind)?.draft ?? ''
    setConfirm({ kind, info: null, text, error: null, hits: null, busy: false })
    const r = await exportLab({ labId: lab.labId, labsRoot: lab.root, kind, text })
    setConfirm(c => (c && c.kind === kind ? (r.ok ? { ...c, info: r.value } : { ...c, error: { code: r.code, message: r.message } }) : c))
  }

  async function submit() {
    const c = confirm
    if (!c || !c.info || c.busy) return
    setConfirm({ ...c, busy: true, error: null })
    const r = await publishLab({ labId: lab.labId, labsRoot: lab.root, kind: c.kind, text: c.text, files: c.info.publishFiles })
    if (!r.ok) { setConfirm({ ...c, busy: false, error: r.code === 'leak_found' ? null : { code: r.code, message: r.message }, hits: r.hits ?? c.hits }); return }
    await write(() => markPublished(d, lab.labId, c.kind, now(), r.value.url))
    const p = r.value.pages
    setPages(prev => ({ ...prev, [c.kind]: p }))
    setConfirm(null)
    toast('Published.')
  }

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); toast('Copied.') } catch { toast('Copy failed. Select the text and copy it by hand.', 'warn') }
  }

  if (title === null) return <Loading /> // a hooked element appears with its final content: no card, and no empty title, before the lab's definition has answered
  return (
    <section className="sr-panel pf-card" data-testid={`portfolio-card-${lab.labId}`} data-lab-id={lab.labId} aria-labelledby={`pf-h-${lab.labId}`}>
      <h2 className="pf-card-title" id={`pf-h-${lab.labId}`} data-testid={`portfolio-card-title-${lab.labId}`} data-content="plan">{title}</h2>
      <ul className="pf-outs">
        {OUTPUTS.map(o => (
          <OutputRow
            key={o.kind} labId={lab.labId} kind={o.kind} item={item(o.kind)} readOnly={readOnly} creating={creating.has(o.kind)} error={errors[o.kind] ?? null} pages={pages[o.kind]}
            onCreate={() => void create(o.kind)} onPublish={() => void open(o.kind as PublishKind)} onCopy={t => void copy(t)}
            onType={t => void write(() => saveDraft(d, lab.labId, o.kind, t, now()))}
            onPosted={() => void write(() => markPublished(d, lab.labId, 'linkedin', now()))}
          />
        ))}
      </ul>
      {confirm && <Confirm state={confirm} pagesNote={!pagesPublished} onSubmit={() => void submit()} onCancel={() => setConfirm(null)} />}
    </section>
  )
}
