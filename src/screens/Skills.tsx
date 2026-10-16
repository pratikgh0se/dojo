import { useMemo } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useRequiredPlanV2 } from '../app/providers'
import { useTodayModel } from '../data/flatHooks'
import { useSessions, useSettings, useTickets } from '../data/hooks'
import type { PlanV2 } from '../data/planV2'
import type { Session, Ticket } from '../data/types'
import { NARROW_QUERY, useMediaQuery } from '../lib/useMediaQuery'
import { coreMinutesOf } from '../rules/prefs'
import { nodeStates, questTicketId } from '../rules/skillView'
import { Loading } from '../ui/Loading'
import { AreaMap } from './skills/AreaMap'
import { AreaView } from './skills/AreaView'
import { useTopicViews } from './skills/useTopicViews'
import { Stats } from './skills/Stats'
import './skills.css'

/** Skills: the AI area map, an area view, the phone tree and Stats. Read-only except a node's next-ticket Start. */
export function Skills() {
  const plan = useRequiredPlanV2()
  const tickets = useTickets()
  const sessions = useSessions()
  const settings = useSettings()
  const model = useTodayModel()
  if (!tickets || !sessions || !settings || !model) return <Loading />
  // The quest is Today's own pick (never recomputed here), so the `next` node and Today's start button agree.
  const questId = questTicketId(model.next)
  return <SkillsBody tickets={tickets} sessions={sessions} plan={plan} questId={questId} coreMinutes={coreMinutesOf(settings, plan.mix)} />
}

function SkillsBody({ plan, tickets, sessions, questId, coreMinutes }: {
  plan: PlanV2; tickets: Ticket[]; sessions: Session[]; questId: string | null; coreMinutes: number
}) {
  const navigate = useNavigate()
  const loc = useLocation()
  const phone = useMediaQuery(NARROW_QUERY)
  const states = useMemo(() => nodeStates(plan, tickets, questId), [plan, tickets, questId])
  const quest = useMemo(() => tickets.find(t => t.id === questId) ?? null, [tickets, questId])
  // the selected tab follows the route: AI (the map and the AI area views), DSA, Design, Stats (TREE-01)
  const tab: 'ai' | 'dsa' | 'design' | 'stats' = /^\/skills\/stats\/?$/.test(loc.pathname) ? 'stats'
    : /^\/skills\/dsa\/?$/.test(loc.pathname) ? 'dsa' : /^\/skills\/design\/?$/.test(loc.pathname) ? 'design' : 'ai'
  const tabs: { id: typeof tab; label: string; to: string }[] = [
    { id: 'ai', label: 'AI', to: '/skills' }, { id: 'dsa', label: 'DSA', to: '/skills/dsa' },
    { id: 'design', label: 'Design', to: '/skills/design' }, { id: 'stats', label: 'Stats', to: '/skills/stats' },
  ]
  const topics = useTopicViews(plan, tickets)
  const view = { plan, tickets, states, phone, nextTicket: quest, topics }
  return (
    <div className="sk">
      <div className="sk-tabs" role="tablist" data-testid="skills-tabs" aria-label="Skills">
        {tabs.map(t => (
          <button key={t.id} type="button" role="tab" className="sk-tab" data-testid={`skills-tab-${t.id}`} aria-selected={tab === t.id} onClick={() => navigate(t.to)}>{t.label}</button>
        ))}
      </div>
      <Routes>
        <Route path="stats" element={<Stats tickets={tickets} sessions={sessions} coreMinutes={coreMinutes} />} />
        <Route path="dsa" element={<AreaView {...view} treeArea="dsa" />} />
        <Route path="design" element={<AreaView {...view} treeArea="design" />} />
        <Route path="area/:areaId" element={<AreaView {...view} />} />
        <Route
          index
          element={plan.areas.length > 0 ? (
            <AreaMap plan={plan} tickets={tickets} states={states} compact={phone} nextTicket={quest} />
          ) : (
            <div className="sk-empty" data-testid="skills-empty" data-empty="true"><p>The skill tree needs the new plan data.</p><Link className="sr-btn" to="/path">Go to Path</Link></div>
          )}
        />
        <Route path="*" element={<Navigate to="/skills" replace />} />
      </Routes>
    </div>
  )
}
