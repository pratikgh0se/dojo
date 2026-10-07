import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DAY_DURATIONS } from '../../src/content/ritual'
import { SAMPLE_SCHEDULE } from '../../src/content/schedule'
import { Ritual } from '../../src/screens/Ritual'
import { freshDb } from '../helpers/db'
import { realPlan, smallPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

describe('Ritual screen', () => {
  it('shows the live rotation label and duration for each day', () => {
    renderWithApp(<Ritual />, { db: freshDb(), plan: realPlan(), route: '/ritual', path: '/ritual' })
    expect(screen.getByTestId('ritual-Wed')).toHaveTextContent('Wednesday · AI · rebuild')
    expect(screen.getByTestId('ritual-Wed')).toHaveTextContent(DAY_DURATIONS.Wed)
    expect(screen.getByTestId('ritual-Sat')).toHaveTextContent('Saturday · AI · build + break')
    expect(screen.getByTestId('ritual-Sat')).toHaveTextContent('3 hours + 30 min, morning')
    expect(screen.getByTestId('ritual-Fri')).toHaveClass('rest')
    expect(screen.getByTestId('ritual-Fri')).toHaveTextContent('0 min')
  })

  it('G6: the day is plan data: intro, timeline, block highlight and inbox come from plan.schedule', () => {
    const schedule = {
      intro: 'My own week.', block: { start: '19:30', end: '20:20' }, inbox: 'my pocket notebook',
      timeline: [{ time: '18:00', what: 'Dinner.' }, { block: true, what: 'The block.' }], timelineNote: 'Note.',
    }
    renderWithApp(<Ritual />, { db: freshDb(), plan: { ...smallPlan, schedule }, route: '/ritual', path: '/ritual' })
    expect(screen.getByText('My own week.')).toBeInTheDocument()
    const rows = within(screen.getByTestId('weekday')).getAllByRole('row')
    expect(rows.find(r => r.textContent?.startsWith('19:30 to 20:20'))).toHaveClass('hl')
    expect(screen.getByText(/goes into your inbox \(my pocket notebook\)/)).toBeInTheDocument()
  })

  it('the sample plan ships the neutral sample day', () => {
    expect(realPlan().schedule).toEqual(SAMPLE_SCHEDULE)
  })

  it('follows whatever rotation the plan has', () => {
    renderWithApp(<Ritual />, { db: freshDb(), plan: smallPlan, route: '/ritual', path: '/ritual' })
    expect(screen.getByTestId('ritual-Wed')).toHaveTextContent('Wednesday · AI · build')
  })

  it('highlights the evening block in the weekday timeline and links the block close to the Map', () => {
    renderWithApp(<Ritual />, { db: freshDb(), plan: realPlan(), route: '/ritual', path: '/ritual' })
    const rows = within(screen.getByTestId('weekday')).getAllByRole('row')
    const block = rows.find(r => r.textContent?.startsWith('21:00 to 21:50'))!
    expect(block).toHaveClass('hl')
    expect(rows.filter(r => r.classList.contains('hl'))).toHaveLength(1)
    expect(screen.getByTestId('open-map')).toHaveAttribute('href', '/map')
    for (const name of ['Saturday news slot', 'Sprint close (every second Sunday)', 'Block close (every fourth sprint)', 'When stuck for more than 30 minutes', 'Tutor prompts, copy and use']) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument()
    }
  })
})
