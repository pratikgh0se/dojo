// Bug 2026-10-11: "Open · DSA bank tab" (url "#bank") started the timer and opened nothing.
// An in-app plan link now opens that screen and never starts the timer; a web link still does.
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { appRoute } from '../../src/lib/appLinks'
import { setNow } from '../../src/lib/clock'
import { loadTimer } from '../../src/lib/timer'
import { Do } from '../../src/screens/Do'
import { seededDb } from '../helpers/db'
import { flatPlanV2 } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

const T = new Date('2026-09-08T21:10:00+05:30').getTime()

describe('appRoute', () => {
  it('maps the old index.html tab anchors to their screens', () => {
    expect(appRoute('#bank')).toBe('/dsa')
    expect(appRoute('#dbank')).toBe('/designs')
    expect(appRoute('#mentors')).toBe('/guide')
    expect(appRoute('#overview')).toBe('/guide')
    expect(appRoute('https://example.com/#bank')).toBeNull()
    expect(appRoute('#tree')).toBe('/skills')
    expect(appRoute('#nope')).toBeNull()
  })
})

describe('Do: Open · on an in-app plan link', () => {
  it('links to the screen and does not start the timer', async () => {
    setNow(() => T)
    const d = await seededDb()
    await d.tickets.update('p200', { links: [{ label: 'DSA bank tab', url: '#bank' }, { label: 'LeetCode 200', url: 'https://leetcode.com/problems/number-of-islands/' }] })
    renderWithApp(<Do />, { db: d, plan: flatPlanV2, route: '/do/p200', path: '/do/:ticketId' })
    const bank = await screen.findByRole('link', { name: /^Open · DSA bank tab/ })
    expect(bank).toHaveAttribute('href', '/dsa')
    expect(bank).not.toHaveAttribute('target')
    fireEvent.click(bank)
    expect(loadTimer()).toBeNull()
  })
})
