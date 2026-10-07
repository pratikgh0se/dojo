import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Vitals } from '../../src/ui/Vitals'

describe('Vitals · Pom panel (README-dashboard Vitals row: Pom)', () => {
  it('mounts pom-stage with form and pose, LV, hidden XP total, and the next-form row', () => {
    render(<Vitals xp={300} possible={6015} pose="training" />)
    const stage = document.querySelector('pom-stage')!
    expect(stage.getAttribute('form')).toBe('0')
    expect(stage.getAttribute('pose')).toBe('training')
    expect(stage.getAttribute('aria-label')).toBe('Pom, form BASE')
    expect(screen.getByTestId('form-name')).toHaveTextContent('BASE')
    expect(screen.getByTestId('level')).toHaveTextContent('LV 30')
    expect(screen.getByTestId('xp-total')).toHaveTextContent('300 XP')
    expect(screen.getByTestId('form-next')).toHaveTextContent('to KINDLE')
    expect(screen.getByTestId('form-next')).toHaveTextContent('1 xp')
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '12')
  })
  it('changes form when the threshold is crossed', () => {
    render(<Vitals xp={301} possible={6015} pose="idle" />)
    expect(screen.getByTestId('form-name')).toHaveTextContent('KINDLE')
    expect(document.querySelector('pom-stage')!.getAttribute('form')).toBe('1')
  })
  it('shows the final form at 100%', () => {
    render(<Vitals xp={6015} possible={6015} pose="idle" />)
    expect(screen.getByTestId('form-next')).toHaveTextContent('SOVEREIGN · final form')
  })
})
