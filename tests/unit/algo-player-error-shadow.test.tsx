import { screen } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'
import type { AlgoJson } from '../../src/rules/algoJson'
import { seededDb } from '../helpers/db'
import { installAlgoEngines } from '../helpers/engines'
import { smallPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'
import { AlgoPlayer } from '../../src/ui/algo/AlgoPlayer'

/** A malformed picture (the AI `picture` job's own seam, AlgoPlayerProps.json): missing `structures`
 * entirely, which is exactly what engine's own `load()`/`build()` treats as its error case. */
const BROKEN = { steps: [] } as unknown as AlgoJson

describe('AlgoPlayer injected shadow style (labs contract §4, Controller addendum 2)', () => {
  beforeAll(installAlgoEngines)

  it('scopes hiding .say to the normal (has a .bar) render, not the engine\'s own error render', async () => {
    const d = await seededDb()
    renderWithApp(<AlgoPlayer json={BROKEN} record={false} />, { db: d, plan: smallPlan })
    const host = await screen.findByRole('group')
    await new Promise(r => setTimeout(r, 0)) // let useLayoutEffect's engine build + style-inject settle
    const shadow = host.shadowRoot!
    const say = shadow.querySelector('.say')
    expect(say?.textContent).toMatch(/NO ALGORITHM/)
    const style = shadow.querySelector('style[data-dojo]')!.textContent!
    // The old rule hid .say unconditionally: `.head,.say,.bar{display:none!important}`. That rule also
    // hides the engine's own error text (a lone `.wrap > .say`, no `.bar` sibling). The fix must only hide
    // `.say` when it sits inside a normal render (one that also has a `.bar`).
    expect(style).not.toMatch(/\.say\s*,|,\s*\.say\s*\{[^}]*display:\s*none/)
    expect(style).toMatch(/\.bar\)\s*\.say/)
  })
})
