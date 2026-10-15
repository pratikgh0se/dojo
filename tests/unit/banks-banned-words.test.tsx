import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { setNow } from '../../src/lib/clock'
import { Banks } from '../../src/screens/Banks'
import { seededDb } from '../helpers/db'
import { realPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

// GLOBAL-01: the private pack set labels one tab "Hello Interview". Stub the pack set so its label (and one item)
// carries the banned word, then assert every occurrence on the Banks screen sits inside a data-content element.
vi.mock('@bank-packs', async () => {
  const real = await vi.importActual<typeof import('../fixtures/banks/packs')>('@bank-packs')
  return {
    ...real,
    PACK_META: real.PACK_META.map(m => (m.id === 'hellointerview' ? { ...m, label: 'Hello Interview' } : m)),
    async loadPacks() {
      const packs = await real.loadPacks()
      const hi = packs.hellointerview as unknown as { items: Array<{ name: string; url: string }> }
      return { ...packs, hellointerview: { ...hi, items: hi.items.map((it, i) => (i === 0 ? { ...it, name: 'Interview Chat', url: 'https://leetcode.com/problems/stub-interview-chat/' } : it)) } }
    },
  }
})

const BANNED = /\binterview/i

function offenders(): string[] {
  const out: string[] = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement
    if (el && el.tagName !== 'TEXTAREA' && BANNED.test(n.textContent ?? '') && !el.closest('[data-content]')) out.push(n.textContent ?? '')
  }
  return out
}

async function setup(route: string) {
  setNow(() => new Date('2026-10-12T09:00:00+05:30').getTime())
  const plan = realPlan()
  const d = await seededDb(plan, '2026-10-05')
  renderWithApp(<Banks />, { db: d, plan, route, path: '/banks' })
  await screen.findByTestId('banks-visible-count')
}

describe('Banks screen, GLOBAL-01', () => {
  it('the stub pack set really renders the banned word (the scan is not vacuous)', async () => {
    await setup('/banks?bank=hellointerview')
    expect(document.body.textContent).toMatch(BANNED)
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Hello Interview')
    expect(screen.getByText('Interview Chat')).toBeInTheDocument()
  })

  it.each(['plan', 'hellointerview', 'neetcode150', 'mine'])('no banned word outside data-content on the %s bank', async bank => {
    await setup(`/banks?bank=${bank}`)
    expect(offenders()).toEqual([])
  })

  it('the Known item note keeps the pack name but marks it as plan content', async () => {
    await setup('/banks?bank=mine')
    fireEvent.change(await screen.findByRole('textbox', { name: 'URL or name' }), { target: { value: 'https://leetcode.com/problems/stub-interview-chat/' } })
    fireEvent.click(screen.getByRole('button', { name: 'Classify' }))
    const note = await screen.findByTestId('mine-suggestion-note')
    expect(note).toHaveTextContent('Known item · Hello Interview')
    expect(offenders()).toEqual([])
  })
})
