import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { ApproachQuestion, Complexity } from '../../src/ui/algo/ApproachStrip'

// UAT J4: "Which approach did you use?" showed no selected state, and "O(2^N)" read as "O(2∧N)".
describe('ApproachQuestion', () => {
  function Harness() {
    const [chosen, setChosen] = useState<string | null>(null)
    return <ApproachQuestion problemId="p91" chosen={chosen} onChoose={setChosen} onBack={() => {}} />
  }
  it('fills the chosen answer (accent), keeps the accessible names, and writes 2^n as a superscript', () => {
    const { container } = render(<Harness />)
    const other = screen.getByRole('button', { name: 'Other' })
    const brute = screen.getByRole('button', { name: 'Brute recursion · O(2^n)' })
    expect(other).toHaveClass('sr-btn-control')
    fireEvent.click(other)
    expect(other).toHaveAttribute('aria-pressed', 'true')
    expect(other).toHaveClass('sr-btn-accent')
    fireEvent.click(brute)
    expect(brute).toHaveClass('sr-btn-accent')
    expect(other).toHaveClass('sr-btn-control')
    expect(brute.querySelector('sup')).toHaveTextContent('n')
    expect(brute).toHaveTextContent(/^Brute recursion · O\(2\^n\)$/) // the text is still the chip's name
    expect(container.querySelector('.vh')).toHaveTextContent('^') // the caret is only hidden
  })
})

describe('Complexity', () => {
  it('turns ^x and ^(…) into superscripts', () => {
    const { container } = render(<p><Complexity text="O(8^(n²)) · O(26^d·L)" /></p>)
    expect(container.textContent).toBe('O(8^(n²)) · O(26^d·L)')
    expect([...container.querySelectorAll('sup')].map(e => e.textContent)).toEqual(['n²', 'd'])
  })
})
