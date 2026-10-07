// The small visible P3s of the code-blind Electron UAT run 3 (dojo-acceptance/reports/uat/dojo-electron-r3.md).
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Screen } from '../../src/app/Screen'
import { setNow } from '../../src/lib/clock'
import { Dsa } from '../../src/screens/Dsa'
import { nodeLines } from '../../src/screens/SkillTree'
import { FILE_REF, WithFileRefs } from '../../src/ui/FileRefs'
import { Loading, LOADING_DELAY_MS } from '../../src/ui/Loading'
import { seededDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

afterEach(() => vi.useRealTimers())

describe('J2: no "Loading…" flash (ruling 9)', () => {
  it('the loading line is there at once but says nothing for the first 300 ms', () => {
    vi.useFakeTimers()
    const { container } = render(<Loading />)
    const p = container.querySelector('p.loading')!
    expect(p).toHaveTextContent(/^$/)
    act(() => { vi.advanceTimersByTime(LOADING_DELAY_MS - 1) })
    expect(p).toHaveTextContent(/^$/)
    act(() => { vi.advanceTimersByTime(1) })
    expect(p).toHaveTextContent('Loading…')
  })

  it('a new screen does not inherit the last one\'s data-ready="true" while it is still loading', async () => {
    let go: (to: string) => void = () => {}
    function Nav() { go = useNavigate(); return null }
    render(
      <MemoryRouter initialEntries={['/a']}>
        <Nav />
        <Routes>
          <Route path="/a" element={<Screen name="today"><p>ready</p></Screen>} />
          <Route path="/b" element={<Screen name="ai"><Loading /></Screen>} />
        </Routes>
      </MemoryRouter>,
    )
    await vi.waitFor(() => expect(screen.getByTestId('screen-today')).toHaveAttribute('data-ready', 'true'))
    act(() => go('/b'))
    expect(screen.getByTestId('screen-ai')).toHaveAttribute('data-ready', 'false')
  })
})

describe('J2: a DSA topic click brings its detail into view', () => {
  it('scrolls the topic detail to the top, smoothly, on a click (not on a restored URL)', async () => {
    const calls: Array<{ el: Element; opts: unknown }> = []
    const had = Object.prototype.hasOwnProperty.call(Element.prototype, 'scrollIntoView')
    const before = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (this: Element, opts?: boolean | ScrollIntoViewOptions) { calls.push({ el: this, opts }) }
    setNow(() => new Date('2026-09-08T10:00:00+05:30').getTime())
    const d = await seededDb(smallPlan)
    renderWithApp(<Dsa />, { db: d, plan: smallPlan, route: '/dsa?topic=1', path: '/dsa' })
    await screen.findByTestId('topic-detail')
    expect(calls).toHaveLength(0) // restored from the URL (Back): the position is the user's
    cleanup()
    renderWithApp(<Dsa />, { db: d, plan: smallPlan, route: '/dsa', path: '/dsa' })
    fireEvent.click(await screen.findByTestId('topic-1'))
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].el).toBe(screen.getByTestId('topic-detail'))
    expect(calls[0].opts).toEqual({ behavior: 'smooth', block: 'start' })
    fireEvent.click(screen.getByTestId('topic-1')) // the open topic again: still brought into view
    expect(calls).toHaveLength(2)
    if (had) Element.prototype.scrollIntoView = before
    else delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
  })
})

describe('J9: skill-tree labels are never clipped (ruling 1)', () => {
  it('every plan label fits two lines of a node, whole', () => {
    const plan = JSON.parse(readFileSync('public/data/plan.json', 'utf8')) as { skills: Array<{ label: string }> }
    for (const { label } of plan.skills) {
      const lines = nodeLines(label)
      expect(lines.length, label).toBeLessThanOrEqual(2)
      expect(lines.join(' '), label).toBe(label)
      expect(lines.join(''), label).not.toContain('…')
    }
    expect(nodeLines('AI engineering (RAG, agents, evals)')).toEqual(['AI engineering (RAG,', 'agents, evals)'])
  })
  it('a label longer than two lines gets a third line, not an ellipsis', () => {
    expect(nodeLines('one two three four five six seven eight nine ten eleven twelve')).toHaveLength(4)
  })
})

describe('J3: repo files in a statement are file references', () => {
  it('renders forge/… paths and bare *.md names as code chips, punctuation outside', () => {
    const text = 'Saturday 1: the black-box lab — forge/labs/00-black-box/README.md (log questions in QUESTIONS.md). Saturday 2: finish forge/stages/00-setup/tests/core, then one lab.'
    const { container } = render(<p><WithFileRefs text={text} /></p>)
    expect([...container.querySelectorAll('code.file-ref')].map(c => c.textContent)).toEqual([
      'forge/labs/00-black-box/README.md', 'QUESTIONS.md', 'forge/stages/00-setup/tests/core',
    ])
    expect(container.textContent).toBe(text)
    expect('grade it against forge/stages/00-setup/rubric.md'.match(FILE_REF)).toEqual(['forge/stages/00-setup/rubric.md'])
    expect('Rebuild from a blank editor'.match(FILE_REF)).toBeNull()
  })
  it('cu-r2 A2#37: a path chip names itself as a repo file and copies its path when pressed', () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const { container } = render(<p><WithFileRefs text="grade it against forge/stages/00-setup/rubric.md." /></p>)
    const chip = container.querySelector('code.file-ref') as HTMLElement
    expect(chip.getAttribute('title')).toMatch(/capstone repo/)
    expect(chip.getAttribute('role')).toBe('button')
    fireEvent.click(chip)
    expect(writeText).toHaveBeenCalledWith('forge/stages/00-setup/rubric.md')
    expect(chip.getAttribute('title')).toBe('Copied')
  })
  it('UAT r4: any bare *.md name is a file reference, never a piece of a URL or of a longer path', () => {
    expect('Open forge/stages/00-setup/redo.md and read it; keep notes in notes.md and NOTES.md.'.match(FILE_REF))
      .toEqual(['forge/stages/00-setup/redo.md', 'notes.md', 'NOTES.md'])
    expect('see https://example.com/docs/guide.md and src/x.md'.match(FILE_REF)).toBeNull()
    expect('the v1.2 notes: release-notes.v2.md'.match(FILE_REF)).toEqual(['release-notes.v2.md'])
  })
})
