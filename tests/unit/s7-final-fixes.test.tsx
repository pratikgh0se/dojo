import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { blocksOf, StatementText } from '../../src/ui/StatementText'

const css = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

describe('s7 final visual fixes', () => {
  it('D1: the Focus strip is pinned to its column, so its nowrap title cannot widen the page', () => {
    expect(css('src/study/pill.css')).toMatch(/\.session-strip\s*\{[^}]*width:\s*100%/)
  })

  it('D4: the statement shows `code` spans as <code>, numbered lines as a list, and no literal backticks', () => {
    const text = 'In `llmjson.py` add `repair(text)`.\n1. First `case`\n2. Second\nDone when it passes.'
    expect(blocksOf(text).map(b => b.kind)).toEqual(['p', 'ol', 'p'])
    const { container } = render(<StatementText text={text} />)
    const card = container.querySelector('[data-testid="ticket-statement"]')!
    expect(card).toHaveAttribute('data-content', 'plan')
    expect(card.textContent).not.toContain('`')
    expect([...card.querySelectorAll('code')].map(c => c.textContent)).toEqual(['llmjson.py', 'repair(text)', 'case'])
    expect(card.querySelectorAll('ol > li')).toHaveLength(2)
  })

  it('D7: on phone both Today actions run the card width (no inset on the quiet one)', () => {
    expect(css('src/screens/quest.css')).not.toMatch(/\.qc-actions \.sr-btn-quiet\s*\{[^}]*calc\(100% - 32px\)/)
  })

  it('D10: a disabled accent button is a dashed outline, not a dimmed fill', () => {
    expect(css('src/screens/review.css')).toMatch(/\.rv-actions \.sr-btn-accent:disabled\s*\{[^}]*dashed/)
  })
})
