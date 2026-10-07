// Controller ruling 21 (r6 P3 #1): the split parent's Do screen has no help ladder. Help is spent on the parts,
// and opening a link on the parent never unlocks paid rungs (r6: Open ▸ on p417 enabled Hint, Picture, Video, Solution).
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { splitIntoSessions } from '../../src/data/splitActions'
import { setNow } from '../../src/lib/clock'
import { loadCycle } from '../../src/lib/cycle'
import { loadTimer } from '../../src/lib/timer'
import { Do } from '../../src/screens/Do'
import { seededDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

const T = new Date('2026-09-08T21:10:00+05:30').getTime()

async function splitParent() {
  setNow(() => T)
  const d = await seededDb()
  await d.tickets.update('p200', { estMin: 60, links: [{ label: 'LeetCode 200', url: 'https://leetcode.com/problems/number-of-islands/' }] })
  const r = await splitIntoSessions(d, 'p200', 2, [], { now: T })
  expect(r.ok).toBe(true)
  return d
}

describe('ruling 21: the split parent has no help ladder', () => {
  it('the parent shows its sessions and no ladder; a part keeps its ladder', async () => {
    const d = await splitParent()
    const view = renderWithApp(<Do />, { db: d, plan: smallPlan, route: '/do/p200', path: '/do/:ticketId' })
    expect(await screen.findByTestId('split-sessions')).toBeInTheDocument()
    expect(screen.queryByTestId('ladder')).toBeNull()
    expect(screen.queryByRole('button', { name: /^Open (Hint|Picture|Video|Solution)/ })).toBeNull()
    view.unmount()

    const part = (await d.tickets.get('p200'))!.children![0]
    renderWithApp(<Do />, { db: d, plan: smallPlan, route: `/do/${part}`, path: '/do/:ticketId' })
    expect(await screen.findByTestId('ladder')).toBeInTheDocument()
  })

  it('Open ▸ on the parent unlocks nothing: no ladder, no timer, no attempt cycle, no help spent', async () => {
    const d = await splitParent()
    renderWithApp(<Do />, { db: d, plan: smallPlan, route: '/do/p200', path: '/do/:ticketId' })
    const open = await screen.findByRole('link', { name: /^Open ▸ LeetCode 200/ })
    fireEvent.click(open)
    await screen.findByTestId('split-sessions')
    expect(screen.queryByTestId('ladder')).toBeNull()
    expect(screen.queryByRole('button', { name: /^Open (Hint|Picture|Video|Solution)/ })).toBeNull()
    expect(loadTimer()).toBeNull()
    expect(loadCycle('p200')).toBeNull()
    expect(await d.rungUses.where('ticketId').equals('p200').count()).toBe(0)
  })
})
