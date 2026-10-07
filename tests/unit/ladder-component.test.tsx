import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { fakeOutput } from '../../src/ai/fake'
import { AppProviders } from '../../src/app/providers'
import { ladderView, type RungName } from '../../src/rules/ladderView'
import { Ladder, type LadderProps } from '../../src/screens/do/Ladder'
import { seededDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'

vi.mock('../../src/ui/algo/AlgoPlayer', () => ({
  AlgoPlayer: ({ json, record }: { json: { title: string; steps: unknown[] }; record?: boolean }) => (
    <section data-testid="lab-player" aria-label={`Player: ${json.title}`} data-walkthrough="picture" data-steps={json.steps.length} data-record={String(record)} />
  ),
}))

const zero: Record<RungName, number> = { attempt: 0, hint: 0, picture: 0, video: 0, solution: 0 }
function props(over: Partial<LadderProps> = {}): LadderProps {
  return {
    title: 'Number of Islands',
    rungs: ladderView({ kind: 'problem', uses: [], elapsedSec: 0, gaveUp: false, redo: false }),
    spent: 0, spentByRung: zero, announce: '', busy: null, errors: {},
    content: { hints: [], hintMoreCost: null, picture: null, video: null, solution: null },
    quizResult: null, onOpen: vi.fn(), onMoreHint: vi.fn(), onRetry: vi.fn(), onCheckQuiz: vi.fn(),
    ...over,
  }
}
const show = (p: LadderProps) => render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Ladder {...p} /></MemoryRouter>)
const NAMES = ['attempt', 'hint', 'picture', 'video', 'solution']

describe('Ladder', () => {
  it('H-01 region, order, states, costs, cubes, names and spent', () => {
    show(props())
    const region = screen.getByRole('region', { name: 'Help ladder' })
    expect(region).toHaveAttribute('data-testid', 'ladder')
    const panels = within(region).getAllByTestId(/^ladder-rung-/)
    expect(panels.map(p => p.dataset.testid)).toEqual(NAMES.map(n => `ladder-rung-${n}`))
    expect(panels.map(p => p.dataset.state)).toEqual(['open', 'locked', 'locked', 'locked', 'locked'])
    expect(panels.map(p => p.dataset.cost)).toEqual(['0', '2', '3', '3', '5'])
    expect(NAMES.map(n => screen.getByTestId(`ladder-cost-${n}`).textContent)).toEqual(['0', '−2', '−3', '−3', '−5'])
    expect(screen.getByTestId('ladder-cost-hint')).toHaveAttribute('title', 'Costs 2 xp')
    expect(screen.getByTestId('ladder-open-hint')).toHaveAccessibleName('Hint, locked, costs 2 xp')
    expect(screen.getByTestId('ladder-open-hint')).toBeDisabled()
    expect(screen.getByTestId('ladder-open-solution')).toHaveAccessibleName('Solution, locked until you give up')
    expect(screen.getByTestId('ladder-spent')).toHaveTextContent('Help spent: 0 xp')
    expect(screen.getByTestId('ladder-spent')).toHaveAttribute('data-xp', '0')
    expect(screen.getByTestId('ladder-announcer')).toHaveAttribute('role', 'status')
  })

  it('an unlocked rung opens in one click; locked ones do nothing (H-05)', () => {
    const p = props({ rungs: ladderView({ kind: 'problem', uses: [], elapsedSec: 600, gaveUp: false, redo: false }) })
    show(p)
    fireEvent.click(screen.getByTestId('ladder-open-picture'))
    fireEvent.click(screen.getByRole('button', { name: 'Open Hint, costs 2 xp' }))
    expect(p.onOpen).toHaveBeenCalledTimes(1)
    expect(p.onOpen).toHaveBeenCalledWith('hint')
  })

  it('task Solution is na without data-cost (H-02)', () => {
    show(props({ rungs: ladderView({ kind: 'stage', uses: [], elapsedSec: 0, gaveUp: false, redo: false }) }))
    const sol = screen.getByTestId('ladder-rung-solution')
    expect(sol.dataset.state).toBe('na')
    expect(sol.hasAttribute('data-cost')).toBe(false)
    expect(screen.getByTestId('ladder-open-solution')).toHaveAccessibleName('Solution, not available for tasks')
    expect(screen.getByTestId('ladder-open-solution')).toBeDisabled()
  })

  it('busy shows the loader in that rung and disables every rung button', () => {
    show(props({ busy: 'hint', rungs: ladderView({ kind: 'problem', uses: [], elapsedSec: 600, gaveUp: false, redo: false }) }))
    expect(within(screen.getByTestId('ladder-rung-hint')).getByTestId('ai-loader')).toBeInTheDocument()
    expect(screen.getByTestId('ladder-open-hint')).toBeDisabled()
  })

  it('an error shows AiError in the rung and Retry calls onRetry with the rung', () => {
    const p = props({ errors: { hint: { code: 'busy', message: 'fake hint unavailable' } }, rungs: ladderView({ kind: 'problem', uses: [], elapsedSec: 600, gaveUp: false, redo: false }) })
    show(p)
    expect(within(screen.getByTestId('ladder-rung-hint')).getByRole('alert')).toHaveTextContent('The AI helper is busy. Try again in a moment.')
    fireEvent.click(screen.getByTestId('ai-retry'))
    expect(p.onRetry).toHaveBeenCalledWith('hint')
  })

  it('an opened rung stays focusable (aria-disabled, not disabled) so focus is not lost after opening it', () => {
    // "attempt" is always 'open'. A real `disabled` on the button that just received focus from
    // the click that opened it would yank focus to <body>, a real keyboard-trap regression.
    show(props())
    const attemptOpen = screen.getByTestId('ladder-open-attempt')
    expect(attemptOpen).not.toBeDisabled()
    expect(attemptOpen).toHaveAttribute('aria-disabled', 'true')
    attemptOpen.focus()
    expect(attemptOpen).toHaveFocus()
  })

  it('H-06/H-07 opened hint: text, second-hint button, why-line with the honesty chart link', () => {
    const rungs = ladderView({ kind: 'problem', uses: [{ rung: 2, cost: 2 }], elapsedSec: 600, gaveUp: false, redo: false })
    const p = props({ rungs, spent: 2, spentByRung: { ...zero, hint: 2 }, content: { hints: ['[fake:hint] one'], hintMoreCost: 2, picture: null, video: null, solution: null } })
    show(p)
    expect(screen.getByTestId('ladder-hint-1')).toHaveTextContent('[fake:hint] one')
    fireEvent.click(screen.getByRole('button', { name: 'Second hint, costs 2 xp' }))
    expect(p.onMoreHint).toHaveBeenCalled()
    const why = screen.getByTestId('ladder-why-hint')
    expect(why.textContent).toBe('Why did I pay for this? Hint cost 2 xp.')
    expect(within(why).getByRole('link', { name: 'See the honesty chart' })).toHaveAttribute('href', '/progress#help-ladder')
    // ui-do D4: rung 1's why line is its description, never a paid-for line
    expect(screen.getByTestId('ladder-why-attempt')).toHaveTextContent('The timer, the links and your log. Always open.')
  })

  it('H-08 video links (new tab, no iframe)', () => {
    const rungs = ladderView({ kind: 'problem', uses: [{ rung: 2, cost: 2 }, { rung: 3, cost: 3 }, { rung: 4, cost: 3 }], elapsedSec: 600, gaveUp: false, redo: false })
    show(props({
      rungs,
      content: {
        hints: ['h'], hintMoreCost: null, solution: null, picture: null,
        video: { links: [{ label: 'NeetCode solution', url: 'https://neetcode.io/solutions/number-of-islands' }], empty: 'No video for this task' },
      },
    }))
    const list = screen.getByRole('list', { name: 'Video links' })
    const a = within(list).getByRole('link', { name: 'NeetCode solution' })
    expect(a).toHaveAttribute('target', '_blank')
    expect(a.getAttribute('rel')).toContain('noopener')
    expect(screen.getByTestId('ladder').querySelector('iframe')).toBeNull()
  })

  it('task picture links; empty video text', () => {
    const rungs = ladderView({ kind: 'design', uses: [{ rung: 2, cost: 3 }, { rung: 3, cost: 4 }, { rung: 4, cost: 3 }], elapsedSec: 600, gaveUp: false, redo: false })
    show(props({
      title: 'The method',
      rungs,
      content: {
        hints: ['h'], hintMoreCost: null, solution: null, picture: null,
        video: { links: [], empty: 'No video for this task' },
      },
    }))
    expect(screen.getByTestId('ladder-rung-video')).toHaveTextContent('No video for this task')
  })

  it('C-INT §2 DSA picture: the figure keeps its caption and holds the labs player, recording off', async () => {
    const json = fakeOutput('picture', { ticket: { id: 'p200', title: 'Number of Islands', track: 'dsa' }, context: {} } as never)
    const rungs = ladderView({ kind: 'problem', uses: [{ rung: 2, cost: 2 }, { rung: 3, cost: 3 }, { rung: 4, cost: 3 }], elapsedSec: 600, gaveUp: false, redo: false })
    const d = await seededDb()
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AppProviders db={d} plan={smallPlan}><Ladder {...props({ rungs, content: { hints: ['h'], hintMoreCost: null, picture: { kind: 'dsa', steps: 15, caption: 'Generated picture · 15 steps', json } as never, video: null, solution: null } })} /></AppProviders></MemoryRouter>)
    const fig = screen.getByRole('figure', { name: 'Picture for Number of Islands' })
    expect(fig).toHaveAttribute('data-testid', 'ladder-picture-player')
    expect(fig).toHaveAttribute('data-steps', '15')
    expect(fig).toHaveTextContent('Generated picture · 15 steps')
    const player = within(fig).getByTestId('lab-player')
    expect(player).toHaveAccessibleName('Player: [fake:picture] Max scan for p200')
    expect(player).toHaveAttribute('data-record', 'false')
    expect(document.body).not.toHaveTextContent('arrives with the labs integration')
  })

  it('C-INT §2 design picture: the figure holds the diagram engine and a Nodes list', async () => {
    const json = fakeOutput('diagram', { ticket: { id: 'd-method', title: 'The method', track: 'design' }, context: { deepDives: [] } } as never)
    const rungs = ladderView({ kind: 'design', uses: [{ rung: 2, cost: 3 }, { rung: 3, cost: 4 }, { rung: 4, cost: 3 }], elapsedSec: 600, gaveUp: false, redo: false })
    const d = await seededDb()
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AppProviders db={d} plan={smallPlan}><Ladder {...props({ title: 'The method', rungs, content: { hints: ['h'], hintMoreCost: null, picture: { kind: 'design', nodes: 4, links: 3, caption: 'Reference architecture · 4 nodes · 3 links', labels: ['Client', 'Gateway', 'Service', 'Counters'], json } as never, video: null, solution: null } })} /></AppProviders></MemoryRouter>)
    const fig = screen.getByTestId('ladder-picture-player')
    expect(fig).toHaveAttribute('data-nodes', '4')
    expect(within(fig).getByTestId('ladder-picture-diagram')).toHaveAccessibleName('Reference architecture for The method')
    expect(within(within(fig).getByRole('list', { name: 'Nodes' })).getAllByRole('listitem').map(li => li.textContent)).toEqual(['Client', 'Gateway', 'Service', 'Counters'])
    expect(document.body).not.toHaveTextContent('arrives with the labs integration')
  })

  it('H-09/H-11 solution region starts with the approach; ≤ 15 pseudocode lines; quiz sends answers', () => {
    const rungs = ladderView({ kind: 'problem', uses: [{ rung: 5, cost: 5 }], elapsedSec: 0, gaveUp: true, redo: false })
    const p = props({
      rungs,
      content: {
        hints: [], hintMoreCost: null, picture: null, video: null,
        solution: { approach: '[fake:solution] Approach for p200.', pseudocode: Array.from({ length: 20 }, (_, i) => `line ${i}`), complexity: 'O(n)', quiz: [{ q: 'Q1?', a: 'a' }, { q: 'Q2?', a: 'b' }, { q: 'Q3?', a: 'c' }] },
      },
      quizResult: 'Understood · 2/3',
    })
    show(p)
    const sol = screen.getByRole('region', { name: 'Solution' })
    expect(sol.textContent!.startsWith('[fake:solution]')).toBe(true)
    expect(within(screen.getByTestId('ladder-solution-pseudocode')).getAllByRole('listitem')).toHaveLength(15)
    const quiz = screen.getByRole('group', { name: 'Check your understanding' })
    fireEvent.change(within(quiz).getByRole('textbox', { name: 'Q1?' }), { target: { value: 'a' } })
    fireEvent.change(screen.getByTestId('ladder-quiz-answer-3'), { target: { value: 'c' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check answers' }))
    expect(p.onCheckQuiz).toHaveBeenCalledWith(['a', '', 'c'])
    expect(screen.getByTestId('ladder-quiz-result')).toHaveTextContent('Understood · 2/3')
  })
})
