import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Guide } from '../../src/screens/Guide'
import { freshDb } from '../helpers/db'
import { flatPlanV2 } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

describe('Guide', () => {
  it('has the three sections, each with a heading and a paragraph, and no banned or guilt words', async () => {
    renderWithApp(<Guide />, { db: freshDb(), plan: flatPlanV2 })
    for (const id of ['overview', 'mentors', 'ritual']) {
      const s = screen.getByTestId(`guide-section-${id}`)
      expect(s.querySelector('h2')).not.toBeNull()
      expect(s.querySelectorAll('p').length).toBeGreaterThan(0)
    }
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/\binterview|\bSpar\b|\bRetreat\b|Dig in|Load check|Slid in|Shift plan/i)
    expect(text).not.toMatch(/overdue|\bmissed (a )?(day|days|session)|\bbehind\b|streak (lost|broken)|you didn'?t|days? (since|without)/i)
  })
})
