import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { toggleBankItem } from '../../src/data/bankActions'
import { setNow } from '../../src/lib/clock'
import type { ItemView } from '../../src/rules/banks'
import { currentSprint } from '../../src/rules/sprint'
import { Board } from '../../src/screens/Board'
import { seededDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const NOW = ist('2026-09-08T10:00:00')
const item = (p: Partial<ItemView> & { id: string; name: string }): ItemView => ({
  url: 'https://leetcode.com/problems/x/', difficulty: 'E', pattern: null, group: 'g', kind: 'problem',
  plan: null, ticketId: p.id, ticket: null, done: false, readOnly: false, ...p,
})

describe('Board with bank tickets', () => {
  it('shows a done bank ticket in Done with its bank chip and no Do button; plan cards have no chip', async () => {
    setNow(() => NOW)
    const d = await seededDb()
    await toggleBankItem(d, item({ id: 'p9001', name: 'Bank Probe' }), 'blind75', NOW, currentSprint(NOW, '2026-09-07'))
    renderWithApp(<Board />, { db: d, plan: smallPlan, route: '/board', path: '/board' })
    const card = await screen.findByTestId('card-p9001')
    expect(within(screen.getByTestId('col-done')).getByTestId('card-p9001')).toBe(card)
    expect(within(card).getByTestId('bank-chip')).toHaveTextContent('Fixture Set B')
    expect(within(card).queryByRole('button', { name: 'Do ▸' })).toBeNull()
    fireEvent.keyDown(card, { key: 'Enter' })
    expect(screen.getByTestId('location')).toHaveTextContent('/board')
    expect(screen.getAllByTestId('bank-chip')).toHaveLength(1)
  })

  it('prints the bank chip once for a design pack item, and a LeetCode item keeps its source chip beside its bank', async () => {
    setNow(() => NOW)
    const d = await seededDb()
    await toggleBankItem(d, item({ id: 'p9002', name: 'Fixture Chat', url: 'https://example.com/fixture/chat' }), 'hellointerview', NOW, currentSprint(NOW, '2026-09-07'))
    await toggleBankItem(d, item({ id: 'p9003', name: 'Probe LC' }), 'blind75', NOW, currentSprint(NOW, '2026-09-07'))
    renderWithApp(<Board />, { db: d, plan: smallPlan, route: '/board', path: '/board' })
    const chat = await screen.findByTestId('card-p9002')
    expect(within(chat).getAllByText('Fixture Designs')).toHaveLength(1)
    expect(within(chat).getByTestId('bank-chip')).toHaveTextContent('Fixture Designs')
    const lc = screen.getByTestId('card-p9003')
    expect(within(lc).getByText('LeetCode')).toBeInTheDocument()
    expect(within(lc).getByTestId('bank-chip')).toHaveTextContent('Fixture Set B')
  })
})
