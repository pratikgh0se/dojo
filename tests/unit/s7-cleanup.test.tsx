import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { applyGrade } from '../../src/data/redoGrade'
import type { Redo } from '../../src/data/types'
import type { Study } from '../../src/rules/studySession'
import { TicketTimer } from '../../src/screens/do/kinds/TicketTimer'
import { blocksOf, StatementText } from '../../src/ui/StatementText'
import { freshDb } from '../helpers/db'
import { appPlans, mkTicket } from '../helpers/planV2'
import { renderWithApp } from '../helpers/render'

const study = vi.hoisted(() => ({ cur: null as unknown }))
vi.mock('../../src/study/useStudy', async importOriginal => ({ ...(await importOriginal<typeof import('../../src/study/useStudy')>()), useStudy: () => study.cur }))

const NOW = new Date(2026, 10, 4, 10).getTime()
const DAY = 86_400_000
const mkStudy = (p: Partial<Study>): Study => ({
  id: 's1', ticketId: 't1', goal: '', cardIds: [], focusMin: 25, breakMin: 5, longBreakMin: 15, startedAt: NOW, phase: 'focus', phaseStart: NOW,
  phaseMin: 25, blocks: 0, progress: false, stuck: false, chime: false, ...p,
})

describe('TicketTimer caption (cleanup 2)', () => {
  it('a Break names the break length, not the focus length', () => {
    study.cur = mkStudy({ phase: 'break', phaseMin: 5 })
    renderWithApp(<TicketTimer ticket={mkTicket({ id: 't1', kind: 'problem', lane: 'dsa' })} />, { db: freshDb(), ...appPlans() })
    const cap = screen.getByTestId('session-phase').parentElement!
    expect(cap).toHaveTextContent(/^Break · 5 min$/)
    expect(cap.textContent).not.toContain('25')
  })
  it('a Focus block names the focus length', () => {
    study.cur = mkStudy({})
    renderWithApp(<TicketTimer ticket={mkTicket({ id: 't1', kind: 'problem', lane: 'dsa' })} />, { db: freshDb(), ...appPlans() })
    expect(screen.getByTestId('session-phase').parentElement).toHaveTextContent(/^Focus · 25 min$/)
  })
})

describe('StatementText (cleanup 3)', () => {
  it('a numbered run starts at its first numeral', () => {
    const { container } = render(<StatementText text={'Steps:\n3. Third\n4. Fourth'} />)
    expect(container.querySelector('ol')).toHaveAttribute('start', '3')
    expect(blocksOf('1. a\n2. b')).toEqual([{ kind: 'ol', items: ['a', 'b'], start: 1 }])
  })
  it('a triple-backtick fence renders as a code block without any backtick', () => {
    const text = 'Run this:\n```python\nx = 1\nprint(x)\n```\nDone.'
    expect(blocksOf(text).map(b => b.kind)).toEqual(['p', 'pre', 'p'])
    const { container } = render(<StatementText text={text} />)
    expect(container.textContent).not.toContain('`')
    expect(container.querySelector('pre code')?.textContent).toBe('x = 1\nprint(x)')
  })
  it('a one-line fence and an unclosed fence also lose their backticks', () => {
    const { container } = render(<StatementText text={'```a = 1```\n```\nb = 2'} />)
    expect(container.textContent).not.toContain('`')
    expect([...container.querySelectorAll('pre')].map(p => p.textContent)).toEqual(['a = 1', 'b = 2'])
  })
})

describe('applyGrade (cleanup 4)', () => {
  const redo = (p: Partial<Redo>): Redo => ({ id: 'r1', ticketId: 't1', source: 'check_failed', createdAt: NOW - 9 * DAY, stage: 0, due: NOW - DAY, passed: [], helpCost: 0, refunded: 0, ...p })
  it('grades a due redo once; the same grade a second time (stale card, second tab) is a no-op', async () => {
    const d = freshDb()
    await d.redos.put(redo({}))
    expect(await applyGrade(d, 'r1', 'got', NOW)).toBe(true)
    const after = (await d.redos.get('r1'))!
    expect(after.stage).toBe(1)
    expect(await applyGrade(d, 'r1', 'got', NOW)).toBe(false)
    expect(await d.redos.get('r1')).toEqual(after)
  })
  it('refuses a redo that is not due yet, a closed one, and a missing one', async () => {
    const d = freshDb()
    const future = redo({ id: 'f', due: NOW + 3 * DAY })
    await d.redos.bulkPut([future, redo({ id: 'c', closedAt: NOW - DAY })])
    expect(await applyGrade(d, 'f', 'got', NOW)).toBe(false)
    expect(await d.redos.get('f')).toEqual(future)
    expect(await applyGrade(d, 'c', 'got', NOW)).toBe(false)
    expect(await applyGrade(d, 'nope', 'got', NOW)).toBe(false)
  })
})
