// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { checkBundle, ENTRY_BUDGET_BYTES, entryChunks } from '../../scripts/bundle-check.mjs'

describe('bundle check', () => {
  it('finds the module entry scripts in the built index.html', () => {
    const html = '<script type="module" crossorigin src="/assets/index-Ab12.js"></script><link rel="modulepreload" href="/assets/vendor-x.js">'
    expect(entryChunks(html)).toEqual(['assets/index-Ab12.js'])
  })
  it('reports entries over the budget only', () => {
    expect(checkBundle({ 'assets/index.js': ENTRY_BUDGET_BYTES })).toEqual([])
    expect(checkBundle({ 'assets/index.js': ENTRY_BUDGET_BYTES + 1 })).toEqual([`assets/index.js is ${ENTRY_BUDGET_BYTES + 1} bytes (budget ${ENTRY_BUDGET_BYTES})`])
  })
})
