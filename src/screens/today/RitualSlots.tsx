import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { Ticket } from '../../data/types'
import { localDayKey } from '../../lib/dates'
import { TRY_MODEL_ID } from '../../rules/ritual'
import { readJson, writeJson } from '../../lib/storage'
import { minutesLabel } from '../../rules/ticketMeta'
import { Button } from '../../ui/primitives'

const KEY = 'dojo-ritual-skipped'
interface Skipped { day: string; ids: string[] }
const isSkipped = (v: unknown): v is Skipped => typeof v === 'object' && v !== null && typeof (v as Skipped).day === 'string' && Array.isArray((v as Skipped).ids)

/** Open ritual tickets as cards, except the one that is already the quest and the weekly try-a-model ticket (its own card, RitualWeekly). A card can be skipped for the day; skipping is never counted or shown again. */
export function RitualSlots({ tickets, nowMs, questId }: { tickets: readonly Ticket[]; nowMs: number; questId?: string }) {
  const day = localDayKey(nowMs)
  const [skipped, setSkipped] = useState<string[]>(() => { const s = readJson(KEY, undefined, isSkipped); return s && s.day === day ? s.ids : [] })
  const cards = tickets.filter(t => !t.archived && t.status === 'todo' && t.id !== questId && (t.lane === 'ritual' || t.kind === 'ritual') && !t.origin.startsWith(`ritual:${TRY_MODEL_ID}:`) && !skipped.includes(t.id))
  if (cards.length === 0) return null
  const skip = (id: string) => { const ids = [...skipped, id]; setSkipped(ids); writeJson(KEY, { day, ids }) }
  return (
    <>
      {cards.map(t => (
        <section key={t.id} className="qc-ritual sr-panel" data-testid={`today-ritual-${t.id}`} aria-label={t.title}>
          <span className="qc-cap">Ritual · {minutesLabel(t.estMin)}</span>
          <span className="qc-rtitle" data-content="plan">{t.title}</span>
          <div className="qc-ractions">
            <Button variant="quiet" data-testid={`today-ritual-skip-${t.id}`} onClick={() => skip(t.id)}>Skip today</Button>
            <Link className="sr-btn sr-btn-quiet" to={`/do/${t.id}`}>Open</Link>
          </div>
        </section>
      ))}
    </>
  )
}
