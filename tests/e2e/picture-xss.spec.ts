// SEC-D-01 (G6 security review): a picture is untrusted text (model output, or anything written to storage).
// In Chromium a broken <img src=x> really fires onerror, so these prove no handler runs, not only that no
// element is built. tests/unit/picture-xss.test.tsx covers the same fields in jsdom.
import { expect, test, type Page } from './fixtures'
import { IST, idbAll, idbPatch, onboard } from './helpers'

const hostile = (flag: string) => `<img src=x onerror="window.${flag}=(window.${flag}||0)+1">`
const X = hostile('__xss')

const algoPicture = {
  title: `Max${X}`,
  complexity: `O(n)${X}`,
  intro: `intro${X}`,
  structures: {
    [`arr${X}`]: { type: 'array', values: [`v${X}`, 2, 3], caption: `cap${X}` },
    g: { type: 'graph', nodes: { [`n${X}`]: {}, b: { label: `lb${X}` } }, edges: [[`n${X}`, 'b', `w${X}`]] },
  },
  code: [`if a < b ${X}`],
  steps: [
    { op: 'pointer', s: `arr${X}`, name: `p${X}`, i: 0, line: 0, say: `say${X}`, vars: { [`k${X}`]: `val${X}` } },
    { op: 'label', g: 'g', n: 'b', text: `tag${X}`, say: `say2${X}` },
  ],
}
const algo2Picture = {
  title: `Sets${X}`,
  complexity: `O(1)${X}`,
  structures: { [`s${X}`]: { type: 'sets', groups: { [`grp${X}`]: [`item${X}`] } } },
  steps: [{ op: 'mark', s: `s${X}`, i: `item${X}`, state: 'done', say: `say${X}`, vars: { [`k${X}`]: `val${X}` } }],
}

const flag = (page: Page, name: string) => page.evaluate(n => (window as unknown as Record<string, unknown>)[n], name)
/** <img> elements inside the elements matching `sel`, shadow roots included. */
const imgs = (page: Page, sel: string) => page.evaluate(s => {
  const walk = (root: Element | ShadowRoot): number =>
    root.querySelectorAll('img').length + [...root.querySelectorAll('*')].reduce((n, e) => n + (e.shadowRoot ? walk(e.shadowRoot) : 0), 0)
  return [...document.querySelectorAll(s)].reduce((n, e) => n + walk(e) + (e.shadowRoot ? walk(e.shadowRoot) : 0), 0)
}, sel)

test('SEC-D-01 the vendored engines show hostile picture text literally and run nothing', async ({ page }) => {
  await page.goto('/')
  // control: the same payload through innerHTML in a shadow root does run here, so a pass below is not vacuous
  await page.evaluate(h => { const d = document.createElement('div'); d.attachShadow({ mode: 'open' }).innerHTML = h; document.body.appendChild(d) }, hostile('__control'))
  await expect.poll(() => flag(page, '__control')).toBe(1)
  await page.evaluate(() => document.body.lastElementChild!.remove())

  await page.addScriptTag({ url: '/engines/algo.js' })
  await page.addScriptTag({ url: '/engines/algo2.js' })
  await page.evaluate(({ a, b, x }) => {
    const add = (tag: string, data: string) => {
      const el = document.createElement(tag)
      el.className = 'xss-probe'
      el.setAttribute('data', data)
      document.body.appendChild(el)
      return el as HTMLElement & { go?: (k: number) => void }
    }
    add('sr-algo', JSON.stringify(a)).go!(1)
    add('sr-algo2', JSON.stringify(b)).go!(1)
    add('sr-algo', JSON.stringify({ error: `boom${x}` }))
    add('sr-algo2', JSON.stringify({ error: `boom${x}` }))
    add('sr-algo', `${x}{`) // JSON.parse quotes the bad input in its message
  }, { a: algoPicture, b: algo2Picture, x: X })

  const probes = page.locator('.xss-probe')
  await expect(probes).toHaveCount(5)
  await expect(probes.nth(0).locator('.badge')).toHaveText(`O(n)${X}`)
  await expect(probes.nth(0).locator('.title')).toHaveText(`MAX${X.toUpperCase()}`)
  await expect(probes.nth(0).locator('.say')).toHaveText(`say${X}`)
  await expect(probes.nth(0).locator('.vars span')).toHaveText(`k${X}val${X}`)
  await expect(probes.nth(0).locator('.stage svg')).toContainText(`p${X}`)
  await expect(probes.nth(1).locator('.badge')).toHaveText(`O(1)${X}`)
  await expect(probes.nth(1).locator('.vars span')).toHaveText(`k${X}val${X}`)
  await expect(probes.nth(1).locator('.stage svg')).toContainText(`item${X}`)
  await expect(probes.nth(2).locator('.say')).toHaveText(`NO ALGORITHM · boom${X}`)
  await expect(probes.nth(3).locator('.say')).toHaveText(`NO ALGORITHM · boom${X}`)
  await expect(probes.nth(4).locator('.say')).toContainText('NO ALGORITHM · ')
  await page.waitForTimeout(500) // the control's onerror fired within a few ms
  expect(await imgs(page, '.xss-probe')).toBe(0)
  expect(await flag(page, '__xss')).toBeUndefined()
})

test('SEC-D-01 a stored hostile picture on the Picture rung shows as text and runs nothing', async ({ page }) => {
  await page.clock.install({ time: IST('2026-10-06T21:10:00') })
  await onboard(page, '2026-10-05')
  await page.goto('/do/p200')
  await page.getByTestId('do-timer-preset-25').click()
  await page.getByRole('button', { name: 'Pause' }).waitFor()
  await page.clock.fastForward('10:00')
  await page.getByTestId('ladder-open-hint').click()
  await page.getByTestId('ladder-open-picture').click()
  await expect(page.getByTestId('ladder-picture-player')).toBeVisible()

  // what an injected model reply stored before the validator, or any write to /db/ops, leaves on the ticket
  const [ticket] = (await idbAll<{ id: string; ai?: Record<string, unknown> }>(page, 'tickets')).filter(t => t.id === 'p200')
  await idbPatch(page, 'tickets', ['p200'], { ai: { ...ticket.ai, picture: algoPicture } })
  await page.reload()

  const player = page.getByTestId('ladder-picture-player')
  await expect(player.getByTestId('lab-complexity')).toHaveText(`O(n)${X}`)
  await expect(player.locator('.lab-title')).toHaveText(`Max${X}`)
  await expect(player.getByTestId('lab-caption')).toHaveText(`intro${X}`)
  await player.getByRole('button', { name: 'Step forward' }).click()
  await expect(player.getByTestId('lab-step-counter')).toHaveText('STEP 1 / 2')
  await expect(player.getByTestId('lab-caption')).toHaveText(`say${X}`)
  await expect(player.locator('.lab-vars dt')).toHaveText(`k${X}`)
  await expect(player.locator('sr-algo .stage svg')).toContainText(`p${X}`)
  await player.getByRole('button', { name: 'Step forward' }).click()
  await expect(player.locator('sr-algo .stage svg')).toContainText(`tag${X}`)
  await page.waitForTimeout(500)
  expect(await imgs(page, '[data-testid=ladder-picture-player]')).toBe(0)
  expect(await flag(page, '__xss')).toBeUndefined()
})
