import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

// The public build ships no bank packs: @bank-packs is the empty module.
vi.mock('@bank-packs', () => ({
  PACK_META: [], PACK_KNOWN_ORDER: [], PACK_DESIGN_OVERLAP: {}, loadPacks: async () => ({}),
}))

import { setNow } from '../../src/lib/clock'
import { Banks } from '../../src/screens/Banks'
import { seededDb } from '../helpers/db'
import { realPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

describe('Banks without packs (public build)', () => {
  it('shows only the Plan bank and Mine; Mine explains how to add problems', async () => {
    setNow(() => new Date('2026-10-12T09:00:00+05:30').getTime())
    const plan = realPlan()
    const d = await seededDb(plan, '2026-10-05')
    renderWithApp(<Banks />, { db: d, plan, route: '/banks', path: '/banks' })
    await screen.findByTestId('banks-visible-count')
    const tabs = within(screen.getByRole('tablist', { name: 'Banks' })).getAllByRole('tab')
    expect(tabs.map(t => t.textContent?.replace(/\s+\d+\/\d+$/, ''))).toEqual(['Plan bank', 'Mine'])
    fireEvent.click(screen.getByRole('tab', { name: /^Mine/ }))
    expect(await screen.findByTestId('banks-empty')).toHaveTextContent('Mine is your own problem list')
    expect(screen.getByTestId('banks-empty')).toHaveTextContent('press Classify')
    expect(screen.getByTestId('mine-input')).toBeInTheDocument()
  })
})
