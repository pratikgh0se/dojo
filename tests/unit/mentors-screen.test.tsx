import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { COMMUNITY_BUDGET, MENTOR_PROTOCOL } from '../../src/content/mentors'
import { communitiesByLane } from '../../src/rules/mentors'
import { Mentors } from '../../src/screens/Mentors'
import { freshDb } from '../helpers/db'
import { realPlan, smallPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

describe('communitiesByLane', () => {
  it('groups the live communities into learner, contributor, program', () => {
    const lanes = communitiesByLane(realPlan())
    expect(lanes.map(l => [l.lane, l.label, l.items.length])).toEqual([
      ['learner', 'Learner rooms', 4], ['contributor', 'Contributor rooms', 4], ['program', 'Programs', 4],
    ])
    expect(communitiesByLane(smallPlan)).toEqual([])
  })
})

describe('mentors content', () => {
  it('has the ten protocol steps and no Friday slot in the budget', () => {
    expect(MENTOR_PROTOCOL).toHaveLength(10)
    expect(MENTOR_PROTOCOL[2].template).toContain('Context: working through makemore part 3')
    expect(COMMUNITY_BUDGET.items.map(i => i.lead)).toEqual(['Mon, 20 min:', 'Wed, 30 min:', 'Sun, 40 min:'])
  })
})

describe('Mentors screen', () => {
  it('renders the rule, protocol, rooms by lane with cards', () => {
    renderWithApp(<Mentors />, { db: freshDb(), plan: realPlan(), route: '/mentors', path: '/mentors' })
    expect(screen.getByTestId('mentor-rule')).toHaveTextContent('Nobody mentors a stranger who asks to be mentored.')
    expect(screen.getAllByTestId(/^step-\d+$/)).toHaveLength(10)
    expect(screen.getAllByTestId('room-card')).toHaveLength(12)
    const learner = screen.getByTestId('lane-learner')
    expect(within(learner).getByRole('link', { name: 'GPU MODE ↗' })).toHaveAttribute('href', 'https://discord.gg/gpumode')
    expect(learner).toHaveTextContent('Learner room. Join month 2, post from month 6.')
    expect(screen.getByRole('heading', { name: 'Weekly community budget' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'People worth following now' })).toBeInTheDocument()
  })

  it('shows the protocol only when the plan has no communities', () => {
    renderWithApp(<Mentors />, { db: freshDb(), plan: smallPlan, route: '/mentors', path: '/mentors' })
    expect(screen.queryByTestId('rooms')).toBeNull()
    expect(screen.getAllByTestId(/^step-\d+$/)).toHaveLength(10)
  })
})
