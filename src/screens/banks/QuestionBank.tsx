import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useDb, usePlanV2 } from '../../app/providers'
import { makeMoreQuestions } from '../../data/bankQuestionActions'
import { useBankExtra, useBankGrades, useRedos } from '../../data/hooks'
import { safeWrite } from '../../data/safeWrite'
import { isReadOnly } from '../../data/writer'
import { now } from '../../lib/clock'
import {
  applyFilters, avoidList, AREA_LABEL, filtersFromParams, filtersSet, LEVELS, nodeProgress, nodesWithQuestions, paramsWithFilters, progressOf, questionsOf,
  QUESTION_TYPES, statusText, TYPE_LABEL, type NodeRef, type QFilters,
} from '../../rules/bankQuestions'
import type { BankArea } from '../../data/types'
import { Loading } from '../../ui/Loading'
import { Button, useToast } from '../../ui/primitives'
import { QuestionPractice } from './QuestionPractice'

/** The nodes a bank area is about: the Design nodes, or every node of the AI areas (not the DSA or ritual-band ones). */
function nodesOfArea(area: BankArea, nodes: readonly { id: string; area: string; kind: string; title: string; oneLiner: string }[]): (NodeRef & { oneLiner: string })[] {
  return nodes
    .filter(n => n.kind !== 'band' && (area === 'design' ? n.area === 'design' : n.area !== 'design' && n.area !== 'dsa'))
    .map(n => ({ id: n.id, area: n.area, title: n.title, oneLiner: n.oneLiner }))
}

/** `filters` is what the user just chose, shown until the address (applied by the router as a transition) has caught up. */
interface TabState { area: BankArea; openId: string | null; openNonce: number; busy: boolean; moreError: string | null; filters: QFilters | null }
const freshTab = (area: BankArea): TabState => ({ area, openId: null, openNonce: 0, busy: false, moreError: null, filters: null })

/** BANK-04 to BANK-26: the Design and AI tabs of /banks (one component, the area is the only difference). */
export function QuestionBank({ area }: { area: BankArea }) {
  const plan = usePlanV2()
  const grades = useBankGrades()
  const extra = useBankExtra()
  const redos = useRedos()
  const d = useDb()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  // The panel stays mounted when the tab changes (the data below is already loaded, so the new tab draws at once), so the state that
  // belongs to one tab is kept with its area and starts afresh when the area differs.
  const [ui, setUi] = useState<TabState>(() => freshTab(area))
  let cur = ui
  if (ui.area !== area) {
    cur = freshTab(area)
    setUi(cur)
  }
  const { openId, openNonce, busy, moreError } = cur
  const patchTab = (a: BankArea, p: Partial<TabState>) => setUi(u => (u.area === a ? { ...u, ...p } : u))
  const setOpenId = (id: string | null) => patchTab(area, { openId: id })
  const readOnly = isReadOnly()

  const nodes = useMemo(() => nodesOfArea(area, plan?.nodes ?? []), [area, plan])
  const all = useMemo(() => questionsOf(area, plan?.qbank, extra, nodes), [area, plan, extra, nodes])

  useEffect(() => { setUi(u => (u.filters ? { ...u, filters: null } : u)) }, [params])

  if (!plan || !grades || !extra || !redos) return <Loading />

  const filters = cur.filters ?? filtersFromParams(params, all)
  const visible = applyFilters(all, filters)
  const prog = progressOf(all, grades)
  const nodeOptions = nodesWithQuestions(all, nodes)
  const node = nodes.find(n => n.id === filters.node) ?? null
  const gradeOf = new Map(grades.map(g => [g.id, g]))
  const open = openId ? all.find(q => q.id === openId) ?? null : null
  const nodeTitle = (id: string): string => nodes.find(n => n.id === id)?.title ?? id

  // filters live in the address; changing one replaces the entry (Back leaves the tab, not the last filter)
  const setFilters = (f: QFilters) => {
    patchTab(area, { filters: f })
    setParams(paramsWithFilters(params, f), { replace: true })
  }
  const patch = (p: Partial<QFilters>) => setFilters({ ...filters, ...p })

  async function more() {
    if (!node || busy || readOnly) return
    const where = area
    patchTab(where, { busy: true, moreError: null })
    try {
      const taken = new Set([...(plan?.qbank ?? []).map(q => q.id), ...(extra ?? []).map(q => q.id)])
      const r = await safeWrite(
        () => makeMoreQuestions(d, { area, node, existing: avoidList(all, node.id), taken }, now()),
        m => toast(m, 'danger'),
      )
      if (r && !r.ok) patchTab(where, { moreError: r.message })
      else if (r) toast(`Added ${r.rows.length} questions to ${node.title}.`)
    } finally {
      patchTab(where, { busy: false })
    }
  }

  const openRow = (id: string) => setUi(u => (u.area === area ? { ...u, openId: id, openNonce: u.openNonce + 1 } : u))

  return (
    <section className="bq" data-testid="banks-q-page" data-area={area}>
      <header className="sr-panel bq-head">
        <h2 className="banks-bank-title">{AREA_LABEL[area]} questions</h2>
        <span className="banks-progress">
          <span className="banks-progress-bar" aria-hidden="true"><i style={{ width: `${prog.total ? Math.round((100 * prog.seen) / prog.total) : 0}%` }} /></span>
          <span data-testid="banks-q-progress" data-seen={prog.seen} data-total={prog.total}>{prog.seen} of {prog.total} seen</span>
        </span>
        {filters.node && (() => {
          const np = nodeProgress(all, grades, filters.node)
          return <span className="banks-meta" data-testid="banks-q-node-progress">{np.seen} of {np.total} seen in this node</span>
        })()}
        <span className="banks-meta" data-testid="banks-q-visible-count">Showing {visible.length} of {all.length}</span>
      </header>

      <div className="banks-controls bq-controls">
        <select aria-label="Node" className="banks-select" data-testid="banks-q-filter-node" value={filters.node} onChange={e => patch({ node: e.target.value })}>
          <option value="">All nodes</option>
          {nodeOptions.map(n => <option key={n.id} value={n.id}>{n.title}</option>)}
        </select>
        <select aria-label="Type" className="banks-select" data-testid="banks-q-filter-type" value={filters.type} onChange={e => patch({ type: e.target.value })}>
          <option value="">All</option>
          {QUESTION_TYPES.map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </select>
        <select aria-label="Difficulty" className="banks-select" data-testid="banks-q-filter-difficulty" value={filters.level} onChange={e => patch({ level: e.target.value })}>
          <option value="">All</option>
          {LEVELS.map(l => <option key={l} value={String(l)}>Level {l}</option>)}
        </select>
        <Button variant="quiet" data-testid="banks-q-clear" disabled={!filtersSet(filters)} onClick={() => setFilters({ node: '', type: '', level: '' })}>Clear filters</Button>
      </div>

      <div className="bq-more">
        <Button data-testid="banks-q-more" disabled={!node || busy || readOnly} aria-busy={busy} onClick={() => void more()}>More questions</Button>
        {!node && <span className="banks-meta" data-testid="banks-q-more-hint">Pick a node first, then ask for five more questions on it.</span>}
        {moreError && <span className="bq-error" role="alert" data-testid="banks-q-more-error">{moreError}</span>}
      </div>

      <div className="bq-body">
        <div className="bq-listwrap">
          {visible.length === 0 ? (
            all.length === 0 ? (
              <p className="banks-empty" data-testid="banks-q-empty" data-empty="true">No questions here yet.</p>
            ) : (
              <div className="banks-empty" data-testid="banks-q-empty" data-empty="true">
                <p>No question matches these filters.</p>
                <Button variant="quiet" onClick={() => setFilters({ node: '', type: '', level: '' })}>Clear filters</Button>
              </div>
            )
          ) : (
            <ul className="bq-list" data-testid="banks-q-list">
              {visible.map(q => {
                const g = gradeOf.get(q.id)
                return (
                  <li key={q.id}>
                    <button
                      type="button" className={`bq-row${q.id === openId ? ' sel' : ''}`} aria-pressed={q.id === openId}
                      data-testid={`banks-q-row-${q.id}`} data-node={q.node} data-type={q.type} data-difficulty={q.difficulty}
                      data-seen={String(!!g)} data-last-grade={g?.grade} onClick={() => openRow(q.id)}
                    >
                      <span className="bq-row-q" {...(q.aiMade ? {} : { 'data-content': 'plan' })}>{q.question}</span>
                      <span className="bq-row-meta">
                        <span className="chip">{TYPE_LABEL[q.type]}</span>
                        <span className="chip">Level {q.difficulty}</span>
                        <span className="chip chip-src">{nodeTitle(q.node)}</span>
                        {q.aiMade && <span className="chip bq-aimade" data-testid={`banks-q-aimade-${q.id}`}>AI-made</span>}
                        <span className="banks-meta">{statusText(g)}</span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        {open && (
          <QuestionPractice
            key={`${open.id}:${openNonce}`} q={open} topic={nodeTitle(open.node)} redos={redos} readOnly={readOnly}
            onDeleted={() => setOpenId(null)}
          />
        )}
      </div>
    </section>
  )
}
