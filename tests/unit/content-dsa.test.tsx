import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DSA_INTRO, DSA_LEARN, DSA_RESOURCES, DSA_SOURCES, LEARNER_RESOURCES, learnLinks } from '../../src/content/dsaLearn'
import { PromptBlock, ProseList, ProseSectionView, ProseTableView } from '../../src/ui/Prose'
import { realPlan } from '../helpers/plan'

describe('DSA study links (extra.json learn + res)', () => {
  it('resolves a topic sprint to its study links', () => {
    expect(learnLinks(1).map(l => l.label)).toEqual(['William Fiset graph theory', 'Striver graph series'])
    // G6: the learner's own patterns repo is a setting (plan.learner.patternsRepo); left out when unset
    expect(learnLinks(15).map(l => l.label)).toEqual(['Design Gurus: Grokking the Coding Interview'])
    expect(learnLinks(15, { patternsRepo: 'https://example.com/me/patterns' })).toEqual([
      DSA_RESOURCES.dg, { label: 'your grokking-patterns repo', url: 'https://example.com/me/patterns' },
    ])
    expect(learnLinks(99)).toEqual([])
  })
  it('every learn key names a resource and every live topic has links', () => {
    expect(Object.values(DSA_LEARN).flat().every(k => DSA_RESOURCES[k] !== undefined || LEARNER_RESOURCES[k] !== undefined)).toBe(true)
    expect(realPlan().dsa_bank.every(w => learnLinks(w.sprint).length > 0)).toBe(true)
  })
})

describe('Prose renderer', () => {
  it('renders a section as a panel with bold leads and external links', () => {
    render(<ProseSectionView section={DSA_SOURCES} />)
    expect(screen.getByRole('heading', { name: 'Which sources, and why' })).toBeInTheDocument()
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(5)
    expect(items[4].textContent).toMatch(/^Skip AlgoMonster \(overlaps Grokking\)/)
    const link = within(items[0]).getByRole('link', { name: 'course ↗' })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })
  it('renders intro and outro, and a plain variant with an h3', () => {
    render(<ProseSectionView section={DSA_INTRO} plain />)
    expect(screen.getByRole('heading', { level: 3, name: 'Hard first, basics to high inside each topic' })).toBeInTheDocument()
    expect(screen.getByText(/^Graphs, then trees, then four weeks of dynamic programming/)).toBeInTheDocument()
    expect(screen.getByText("Difficulty tags are LeetCode's. P marks a premium problem; skip it if you do not subscribe.")).toBeInTheDocument()
  })
  it('joins a lead to punctuation without a space', () => {
    render(<ProseList items={[{ lead: 'Where your experience is the answer', text: ', the deep dive says so.' }]} />)
    expect(screen.getByRole('listitem').textContent).toBe('Where your experience is the answer, the deep dive says so.')
  })
  it('renders tables, highlights rows, and prompt templates', () => {
    render(
      <>
        <ProseTableView table={{ title: 'T', head: ['A', 'B'], rows: [['1', '2'], ['3', '4']], note: 'n' }} highlightRow={r => r[0] === '3'} />
        <PromptBlock prompt={{ title: 'For a paper', body: 'line one\nline two' }} />
      </>,
    )
    expect(screen.getAllByRole('columnheader').map(h => h.textContent)).toEqual(['A', 'B'])
    expect(screen.getAllByRole('row')[2]).toHaveClass('hl')
    expect(screen.getByText('n')).toBeInTheDocument()
    expect(screen.getByText(/line one/).tagName).toBe('PRE')
  })
})
