import { afterEach, describe, expect, it } from 'vitest'
import { titleExternalLinks } from '../../src/lib/linkTitles'

describe('titleExternalLinks (UAT cu-r3b P3-3)', () => {
  afterEach(() => { document.body.innerHTML = '' })
  it('titles an external link with its address on hover, keeps an existing title, ignores internal links', () => {
    document.body.innerHTML = `<a id="a" target="_blank" href="https://leetcode.com/problems/x/">x</a>
      <a id="b" target="_blank" title="Mine" href="https://example.com/">y</a><a id="c" href="/board">z</a>`
    const off = titleExternalLinks()
    for (const id of ['a', 'b', 'c']) document.getElementById(id)!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(document.getElementById('a')!.title).toBe('https://leetcode.com/problems/x/')
    expect(document.getElementById('b')!.title).toBe('Mine')
    expect(document.getElementById('c')!.hasAttribute('title')).toBe(false)
    off()
  })
})
