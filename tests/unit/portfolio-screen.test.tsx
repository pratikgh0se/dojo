// R2 W6: the Portfolio screen against portfolio.md (PORT-01 to PORT-19, PORT-20 to PORT-32, PORT-34, PORT-47, PORT-49): the fetches are stubbed.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DojoDB } from '../../src/data/db'
import { Portfolio, PORTFOLIO_EMPTY } from '../../src/screens/Portfolio'
import { freshDb } from '../helpers/db'
import { appPlans } from '../helpers/planV2'
import { exportReply, REPO_URL, seedPort, TITLES, WRITEUPS } from '../helpers/portfolioFixture'
import { renderWithApp } from '../helpers/render'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
type Call = { url: string; body: Record<string, unknown> | null }
let calls: Call[]
/** Stubs the server: /labs/info (the lab title) and /portfolio/*; `over` replaces an export reply or answers publish. */
function stub(o: { exp?: (b: Record<string, unknown>) => Record<string, unknown>; pub?: (b: Record<string, unknown>) => Response } = {}) {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
    calls.push({ url, body })
    if (url.startsWith('/labs/info')) {
      const id = new URL(url, 'http://x').searchParams.get('labId') as keyof typeof TITLES
      return json({ ok: true, title: TITLES[id], path: `labs/${id}`, repo: 'ai-platform-lab', version: 1, timeoutSec: 120, tickets: [], closingTicket: '', milestones: [], rubric: [] })
    }
    if (url === '/portfolio/export') {
      const b = body!
      const kind = (b.kind as string | undefined) ?? 'repo'
      const base = exportReply(b.labId as 'pf-a' | 'pf-b', kind === 'repo' ? {} : { publishFiles: ['README.md', kind === 'site' ? `labs/${b.labId}.md` : `writing/${b.labId}.md`], urls: [`https://fixture-user.github.io/ai-infra-portfolio/${kind === 'site' ? 'labs' : 'writing'}/${b.labId}`], repo: 'ai-infra-portfolio' })
      return json({ ...base, ...(o.exp?.(b) ?? {}) })
    }
    if (url === '/portfolio/publish') return o.pub ? o.pub(body!) : json({ ok: true, url: REPO_URL(String(body!.labId)) })
    return json({ ok: false, error: { code: 'unknown_route', message: 'no' } }, 404)
  }))
}
afterEach(() => { vi.unstubAllGlobals(); localStorage.setItem('dojo.writer', 'test-writer') })
beforeEach(() => stub())

async function open(): Promise<DojoDB> {
  const d = freshDb()
  await seedPort(d)
  renderWithApp(<Portfolio />, { db: d, ...appPlans({}), route: '/portfolio' })
  await screen.findByTestId('portfolio-card-pf-a')
  return d
}
const tid = (id: string) => screen.getByTestId(id)
const has = (id: string) => screen.queryByTestId(id) !== null
const click = (id: string) => fireEvent.click(tid(id))
const row = async (d: DojoDB, id: string) => d.portfolioItems.get(id)
const textOf = (id: string) => (tid(id) as HTMLTextAreaElement).value

describe('Portfolio screen: cards (PORT-02 to PORT-05)', () => {
  it('with no proven lab: the exact empty line, no button or link, no card', async () => {
    const d = freshDb()
    renderWithApp(<Portfolio />, { db: d, ...appPlans({}), route: '/portfolio' })
    expect(await screen.findByTestId('portfolio-title')).toHaveTextContent('Portfolio')
    const empty = await screen.findByTestId('portfolio-empty')
    expect(empty).toHaveTextContent(PORTFOLIO_EMPTY)
    expect(empty.textContent).toBe('Labs you build and get reviewed will appear here.')
    expect(empty).toHaveAttribute('data-empty', 'true')
    expect(within(empty).queryAllByRole('button')).toHaveLength(0)
    expect(within(empty).queryAllByRole('link')).toHaveLength(0)
    expect(document.querySelector('[data-testid^="portfolio-card-"]')).toBeNull()
  })

  it('one card per Proven lab in ascending id; the lab whose latest review failed has none; titles read data-content plan', async () => {
    await open()
    const cards = Array.from(document.querySelectorAll('[data-testid^="portfolio-card-pf"]:not([data-testid*="title"])')).map(c => c.getAttribute('data-lab-id'))
    expect(cards).toEqual(['pf-a', 'pf-b'])
    expect(has('portfolio-empty')).toBe(false)
    await waitFor(() => expect(tid('portfolio-card-title-pf-a')).toHaveTextContent('Portfolio fixture lab A'))
    expect(tid('portfolio-card-title-pf-b')).toHaveAttribute('data-content', 'plan')
  })

  it('four outputs in order, labelled, all Not started with Create draft and nothing else', async () => {
    await open()
    const kinds = ['repo', 'site', 'article', 'linkedin']
    const outs = Array.from(within(tid('portfolio-card-pf-a')).getAllByTestId(/^portfolio-out-pf-a-/)).map(e => e.getAttribute('data-kind'))
    expect(outs).toEqual(kinds)
    const labels = ['Public lab repo', 'Portfolio site page', 'Article draft', 'LinkedIn post draft']
    kinds.forEach((k, i) => {
      expect(tid(`portfolio-out-pf-a-${k}`)).toHaveAttribute('data-status', 'none')
      expect(tid(`portfolio-label-pf-a-${k}`)).toHaveTextContent(labels[i])
      expect(tid(`portfolio-status-pf-a-${k}`)).toHaveTextContent('Not started')
      expect(tid(`portfolio-create-pf-a-${k}`)).toHaveTextContent('Create draft')
      expect(tid(`portfolio-create-pf-a-${k}`)).toBeEnabled()
      for (const p of ['text', 'publish', 'copy', 'posted']) expect(has(`portfolio-${p}-pf-a-${k}`)).toBe(false)
    })
  })

  it('writes nothing and calls no portfolio route on load; only the lab title is read', async () => {
    const d = await open()
    await waitFor(() => expect(tid('portfolio-card-title-pf-a')).toHaveTextContent('Portfolio fixture lab A'))
    expect(await d.portfolioItems.count()).toBe(0)
    expect(await d.aiLog.count()).toBe(0)
    expect(calls.filter(c => c.url.startsWith('/portfolio'))).toEqual([])
    expect(document.querySelector('[data-accent="primary"]')).toBeNull() // PORT-49: no accent without a dialog
  })
})

describe('Portfolio screen: drafts (PORT-06 to PORT-19)', () => {
  it('Create draft (repo): the stored row and the text area, Publish shown, Create gone, no AI call, only the export route', async () => {
    const d = await open()
    click('portfolio-create-pf-a-repo')
    await waitFor(async () => expect(await row(d, 'pf-a:repo')).toBeTruthy())
    const r = (await row(d, 'pf-a:repo'))!
    expect(r).toMatchObject({ labId: 'pf-a', kind: 'repo', status: 'draft' })
    expect(r.draft.startsWith('Built with reference hints on Fixture A first step, Fixture A second step.\n\n# Portfolio fixture lab A\n')).toBe(true)
    await waitFor(() => expect(tid('portfolio-out-pf-a-repo')).toHaveAttribute('data-status', 'draft'))
    expect(tid('portfolio-status-pf-a-repo')).toHaveTextContent('Draft')
    expect(textOf('portfolio-text-pf-a-repo')).toBe(r.draft)
    expect(tid('portfolio-publish-pf-a-repo')).toHaveTextContent('Publish')
    expect(has('portfolio-create-pf-a-repo')).toBe(false)
    expect(has('portfolio-copy-pf-a-repo')).toBe(false)
    expect(await d.aiLog.count()).toBe(0)
    expect(calls.filter(c => c.url.startsWith('/portfolio')).map(c => c.url)).toEqual(['/portfolio/export'])
    expect(calls.find(c => c.url === '/portfolio/export')!.body).toEqual({ labId: 'pf-a', labsRoot: '~/labs', login: false })
  })

  it('article: the button is disabled while the job runs and two quick presses make one row and one log entry; Copy and Publish appear', async () => {
    const d = await open()
    const b = tid('portfolio-create-pf-a-article')
    fireEvent.click(b); fireEvent.click(b)
    await waitFor(() => expect(tid('portfolio-create-pf-a-article')).toBeDisabled())
    await waitFor(async () => expect(await row(d, 'pf-a:article')).toBeTruthy(), { timeout: 3000 })
    expect((await row(d, 'pf-a:article'))!.draft).toBe('Built with reference hints on Fixture A first step, Fixture A second step.\n\n# Portfolio fixture lab A\n\nFake article draft built from the write-up, 2 journal entries and 3 stronger versions.')
    expect(await d.portfolioItems.count()).toBe(1)
    expect(await d.aiLog.count()).toBe(1)
    await waitFor(() => expect(has('portfolio-copy-pf-a-article')).toBe(true))
    expect(has('portfolio-publish-pf-a-article')).toBe(true)
  })

  it('linkedin: the contract sentence, Copy and Mark as posted but no Publish; Mark as posted makes it read-only "Posted" with no url', async () => {
    const d = await open()
    click('portfolio-create-pf-a-linkedin')
    await waitFor(() => expect(has('portfolio-text-pf-a-linkedin')).toBe(true), { timeout: 3000 })
    expect(textOf('portfolio-text-pf-a-linkedin')).toBe('Fake LinkedIn draft for Portfolio fixture lab A. Built from the write-up and 3 stronger versions.')
    expect(has('portfolio-copy-pf-a-linkedin')).toBe(true)
    expect(tid('portfolio-posted-pf-a-linkedin')).toHaveTextContent('Mark as posted')
    expect(has('portfolio-publish-pf-a-linkedin')).toBe(false)
    click('portfolio-posted-pf-a-linkedin')
    await waitFor(() => expect(tid('portfolio-out-pf-a-linkedin')).toHaveAttribute('data-status', 'published'))
    expect(tid('portfolio-status-pf-a-linkedin')).toHaveTextContent('Posted')
    expect(tid('portfolio-text-pf-a-linkedin')).toHaveAttribute('readonly')
    expect(has('portfolio-posted-pf-a-linkedin')).toBe(false)
    expect(has('portfolio-copy-pf-a-linkedin')).toBe(true)
    const r = (await row(d, 'pf-a:linkedin'))!
    expect(r.status).toBe('published')
    expect('url' in r).toBe(false)
    expect(calls.filter(c => c.url.startsWith('/portfolio/publish'))).toEqual([])
  })

  it('an AI failure (FAKE-INVALID): error with its code and Retry, an empty editable text area, no row; typing writes the row and clears both; Retry reads the write-up again', async () => {
    stub({ exp: () => ({ writeup: `${WRITEUPS['pf-a']}\nFAKE-INVALID\n` }) })
    const d = await open()
    click('portfolio-create-pf-a-article')
    await waitFor(() => expect(has('portfolio-draft-error-pf-a-article')).toBe(true), { timeout: 3000 })
    expect(tid('portfolio-draft-error-pf-a-article')).toHaveAttribute('data-code', 'invalid_output')
    expect(tid('portfolio-draft-error-pf-a-article').textContent).not.toBe('')
    expect(has('portfolio-retry-pf-a-article')).toBe(true)
    expect(await d.portfolioItems.count()).toBe(0)
    expect(await d.aiLog.toArray()).toMatchObject([{ job: 'portfolio_draft', ok: false }])
    const box = tid('portfolio-text-pf-a-article') as HTMLTextAreaElement
    expect(box.value).toBe('')
    expect(box.readOnly).toBe(false)
    // retry after the write-up is fixed
    stub()
    click('portfolio-retry-pf-a-article')
    await waitFor(async () => expect((await row(d, 'pf-a:article'))?.draft).toContain('Fake article draft'), { timeout: 3000 })
    await waitFor(() => expect(has('portfolio-draft-error-pf-a-article')).toBe(false))
  })

  it('typing into the text area of the failed draft writes the row at once', async () => {
    stub({ exp: () => ({ writeup: `${WRITEUPS['pf-a']}\nFAKE-INVALID\n` }) })
    const d = await open()
    click('portfolio-create-pf-a-article')
    await waitFor(() => expect(has('portfolio-retry-pf-a-article')).toBe(true), { timeout: 3000 })
    fireEvent.change(tid('portfolio-text-pf-a-article'), { target: { value: 'My own notes.' } })
    await waitFor(async () => expect(await row(d, 'pf-a:article')).toMatchObject({ status: 'draft', draft: 'My own notes.' }))
    await waitFor(() => expect(has('portfolio-draft-error-pf-a-article')).toBe(false))
    expect(has('portfolio-retry-pf-a-article')).toBe(false)
  })

  it('every keystroke is saved (PORT-15): the stored draft follows the text area and updatedAt moves', async () => {
    const d = await open()
    click('portfolio-create-pf-a-repo')
    await waitFor(() => expect(has('portfolio-text-pf-a-repo')).toBe(true))
    const before = (await row(d, 'pf-a:repo'))!
    const box = tid('portfolio-text-pf-a-repo') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: `${box.value} Extra line.` } })
    await waitFor(async () => expect((await row(d, 'pf-a:repo'))!.draft.endsWith(' Extra line.')).toBe(true))
    const after = (await row(d, 'pf-a:repo'))!
    expect(after.updatedAt).toBeGreaterThanOrEqual(before.updatedAt)
    expect(after.status).toBe('draft')
  })

  it('Copy puts exactly the text area on the clipboard, with a toast, and changes nothing', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const d = await open()
    click('portfolio-create-pf-b-article')
    await waitFor(() => expect(has('portfolio-text-pf-b-article')).toBe(true), { timeout: 3000 })
    const before = (await row(d, 'pf-b:article'))!
    click('portfolio-copy-pf-b-article')
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(textOf('portfolio-text-pf-b-article')))
    expect(await screen.findByTestId('toast')).toHaveTextContent('Copied')
    expect(await row(d, 'pf-b:article')).toEqual(before)
  })

  it('the repo draft needs the lab folder: not_set_up is shown with its code, nothing is written, the other lab still works', async () => {
    stub({ pub: () => json({}) })
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null
      if (url === '/portfolio/export' && body.labId === 'pf-a') return json({ ok: false, error: { code: 'not_set_up', message: 'The lab folder was not found, so set up the lab again.' } }, 409)
      if (url === '/portfolio/export') return json(exportReply('pf-b'))
      return json({ ok: false }, 404)
    }))
    const d = await open()
    click('portfolio-create-pf-a-repo')
    await waitFor(() => expect(has('portfolio-draft-error-pf-a-repo')).toBe(true))
    expect(tid('portfolio-draft-error-pf-a-repo')).toHaveAttribute('data-code', 'not_set_up')
    expect(await d.portfolioItems.count()).toBe(0)
    click('portfolio-create-pf-b-repo')
    await waitFor(async () => expect(await row(d, 'pf-b:repo')).toBeTruthy())
  })

  it('the site draft with gh signed out: its code and the exact message, no row; the repo draft still works', async () => {
    const gh = { ok: false, code: 'gh_not_logged_in', message: 'GitHub CLI is not signed in. Run gh auth login in a terminal, then try again.' }
    stub({ exp: () => ({ gh, urls: [], repoUrl: null }) })
    const d = await open()
    click('portfolio-create-pf-a-site')
    await waitFor(() => expect(has('portfolio-draft-error-pf-a-site')).toBe(true))
    expect(tid('portfolio-draft-error-pf-a-site')).toHaveAttribute('data-code', 'gh_not_logged_in')
    expect(tid('portfolio-draft-error-pf-a-site')).toHaveTextContent(gh.message)
    expect(await d.portfolioItems.count()).toBe(0)
    click('portfolio-create-pf-a-repo')
    await waitFor(async () => expect(await row(d, 'pf-a:repo')).toBeTruthy())
  })
})

async function withDraft(kind: 'repo' | 'site' | 'article', labId = 'pf-a'): Promise<DojoDB> {
  const d = await open()
  click(`portfolio-create-${labId}-${kind}`)
  await waitFor(() => expect(has(`portfolio-publish-${labId}-${kind}`)).toBe(true), { timeout: 3000 })
  return d
}
const FILES7 = ['README.md', 'labs/pf-a/.gitignore', 'labs/pf-a/Makefile', 'labs/pf-a/README.md', 'labs/pf-a/WRITEUP.md', 'labs/pf-a/src/main.py', 'labs/pf-a/tests/test_solve.py']

describe('Portfolio screen: the confirm screen (PORT-20 to PORT-23, PORT-49)', () => {
  it('lists the repo, every file, the exact URL, with Publish enabled and nothing sent', async () => {
    await withDraft('repo')
    click('portfolio-publish-pf-a-repo')
    const dlg = await screen.findByTestId('portfolio-confirm')
    expect(dlg).toHaveAttribute('role', 'dialog')
    expect(dlg).toHaveAccessibleName()
    await waitFor(() => expect(has('portfolio-confirm-files')).toBe(true))
    expect(tid('portfolio-confirm-repo')).toHaveTextContent(/^fixture-user\/ai-platform-lab$/)
    expect(tid('portfolio-confirm-files')).toHaveAttribute('data-count', '7')
    FILES7.forEach((p, i) => expect(tid(`portfolio-confirm-file-${i + 1}`).textContent).toBe(p))
    expect(tid('portfolio-confirm-url').textContent).toBe('https://github.com/fixture-user/ai-platform-lab/tree/main/labs/pf-a')
    expect(tid('portfolio-confirm-submit')).toBeEnabled()
    expect(tid('portfolio-confirm-submit')).toHaveTextContent('PUBLISH · REPO')
    expect(tid('portfolio-confirm-submit')).toHaveAttribute('data-accent', 'primary')
    expect(document.querySelectorAll('[data-accent="primary"]')).toHaveLength(1)
    expect(within(dlg).getAllByRole('button').map(b => b.getAttribute('data-testid'))).toEqual(['portfolio-confirm-cancel', 'portfolio-confirm-submit']) // the accent is last in tab order (GLOBAL-03, PORT-49)
    expect(has('portfolio-confirm-hits')).toBe(false)
    expect(has('portfolio-confirm-dirty')).toBe(false)
    expect(has('portfolio-confirm-pages-note')).toBe(false)
    expect(calls.filter(c => c.url === '/portfolio/publish')).toEqual([])
    const exp = calls.filter(c => c.url === '/portfolio/export').slice(-1)[0].body!
    expect(exp).toMatchObject({ labId: 'pf-a', labsRoot: '~/labs', kind: 'repo' })
    expect(String(exp.text)).toContain('# Portfolio fixture lab A')
  })

  it('Cancel and Esc close it and change nothing', async () => {
    const d = await withDraft('repo')
    const before = (await row(d, 'pf-a:repo'))!
    click('portfolio-publish-pf-a-repo')
    await screen.findByTestId('portfolio-confirm')
    click('portfolio-confirm-cancel')
    expect(has('portfolio-confirm')).toBe(false)
    click('portfolio-publish-pf-a-repo')
    const dlg = await screen.findByTestId('portfolio-confirm')
    fireEvent.keyDown(dlg, { key: 'Escape' })
    expect(has('portfolio-confirm')).toBe(false)
    expect(await row(d, 'pf-a:repo')).toEqual(before)
    expect(calls.filter(c => c.url === '/portfolio/publish')).toEqual([])
  })

  it('the uncommitted-changes note appears for the repo only', async () => {
    stub({ exp: () => ({ uncommitted: true }) })
    await withDraft('repo')
    click('portfolio-publish-pf-a-repo')
    await waitFor(() => expect(tid('portfolio-confirm-dirty').textContent).toBe('Uncommitted changes in the lab folder are not included.'))
  })

  it('the first site publish shows the Pages note (exact text); with a site or article already published it does not', async () => {
    const d = await withDraft('site')
    click('portfolio-publish-pf-a-site')
    await waitFor(() => expect(has('portfolio-confirm-pages-note')).toBe(true))
    expect(tid('portfolio-confirm-pages-note').textContent).toBe('First time: turn on GitHub Pages once. In the repository Settings, open Pages and choose branch main and the root folder. Dojo does not change repository settings.')
    expect(tid('portfolio-confirm-repo').textContent).toBe('fixture-user/ai-infra-portfolio')
    expect(tid('portfolio-confirm-submit')).toHaveTextContent('PUBLISH · SITE')
    expect(tid('portfolio-confirm-url').textContent).toBe('https://fixture-user.github.io/ai-infra-portfolio/labs/pf-a')
    click('portfolio-confirm-cancel')
    await d.portfolioItems.put({ id: 'pf-b:article', labId: 'pf-b', kind: 'article', status: 'published', draft: '# B', updatedAt: 1, publishedAt: 1, url: 'u' })
    click('portfolio-publish-pf-a-site')
    await screen.findByTestId('portfolio-confirm-files')
    expect(has('portfolio-confirm-pages-note')).toBe(false)
  })
})

describe('Portfolio screen: the leak scan blocks publishing (PORT-25 to PORT-32)', () => {
  const hit = (n: number, rule: string, text: string) => ({ file: 'labs/pf-a/notes.txt', line: n, rule, text })
  it('hits are listed with file, line, rule and text; Publish is disabled with the error code and there is no override', async () => {
    stub({ exp: () => ({ hits: [hit(3, 'home-path', 'Data is in /Users/someone/x/data.csv'), hit(4, 'email', 'Contact someone@example.org for details.')] }) })
    await withDraft('repo')
    click('portfolio-publish-pf-a-repo')
    await waitFor(() => expect(has('portfolio-confirm-hits')).toBe(true))
    expect(tid('portfolio-confirm-hits')).toHaveAttribute('data-count', '2')
    expect(tid('portfolio-hit-1')).toHaveAttribute('data-file', 'labs/pf-a/notes.txt')
    expect(tid('portfolio-hit-1')).toHaveAttribute('data-line', '3')
    expect(tid('portfolio-hit-1')).toHaveAttribute('data-rule', 'home-path')
    expect(tid('portfolio-hit-text-1').textContent).toContain('/Users/someone/x')
    expect(tid('portfolio-hit-file-2').textContent).toBe('labs/pf-a/notes.txt')
    expect(tid('portfolio-hit-line-2').textContent).toBe('4')
    expect(tid('portfolio-hit-rule-2').textContent).toBe('email')
    expect(tid('portfolio-hit-text-2').textContent).toContain('someone@example.org')
    expect(tid('portfolio-confirm-error')).toHaveAttribute('data-code', 'leak_found')
    expect(tid('portfolio-confirm-submit')).toBeDisabled()
    expect(within(tid('portfolio-confirm')).getAllByRole('button')).toHaveLength(2)
    fireEvent.click(tid('portfolio-confirm-submit'))
    expect(calls.filter(c => c.url === '/portfolio/publish')).toEqual([])
  })
  it('the publish route scanning again (leak_found with hits) shows those hits and keeps the dialog open', async () => {
    stub({ pub: () => json({ ok: false, error: { code: 'leak_found', message: 'x', hits: [hit(3, 'token', 'ghp_0123456789abcdefghijABCDEFGHIJ012345')] } }, 422) })
    await withDraft('repo')
    click('portfolio-publish-pf-a-repo')
    await waitFor(() => expect(tid('portfolio-confirm-submit')).toBeEnabled())
    click('portfolio-confirm-submit')
    await waitFor(() => expect(has('portfolio-confirm-hits')).toBe(true))
    expect(tid('portfolio-hit-1')).toHaveAttribute('data-rule', 'token')
    expect(tid('portfolio-confirm-error')).toHaveAttribute('data-code', 'leak_found')
    expect(tid('portfolio-confirm-submit')).toBeDisabled()
  })
  it('a leak in an edited site draft is shown with its publish path', async () => {
    stub({ exp: (b) => (b.kind === 'site' ? { hits: [{ file: 'labs/pf-a.md', line: 20, rule: 'home-path', text: 'Data is in /Users/someone/project/data.csv' }] } : {}) })
    await withDraft('site')
    click('portfolio-publish-pf-a-site')
    await waitFor(() => expect(has('portfolio-confirm-hits')).toBe(true))
    expect(tid('portfolio-hit-1')).toHaveAttribute('data-file', 'labs/pf-a.md')
    expect(tid('portfolio-confirm-submit')).toBeDisabled()
  })
})

describe('Portfolio screen: publishing and its errors (PORT-33, PORT-34, PORT-41 to PORT-43)', () => {
  it('a confirmed publish sends the listed paths and the text, then stores the published row with its url; the dialog closes with a toast', async () => {
    const d = await withDraft('repo')
    const text = (await row(d, 'pf-a:repo'))!.draft
    click('portfolio-publish-pf-a-repo')
    await waitFor(() => expect(tid('portfolio-confirm-submit')).toBeEnabled())
    click('portfolio-confirm-submit')
    await waitFor(() => expect(has('portfolio-confirm')).toBe(false))
    expect(calls.find(c => c.url === '/portfolio/publish')!.body).toEqual({ labId: 'pf-a', labsRoot: '~/labs', kind: 'repo', text, files: FILES7 })
    const r = (await row(d, 'pf-a:repo'))!
    expect(r).toMatchObject({ status: 'published', url: REPO_URL('pf-a'), draft: text })
    expect(typeof r.publishedAt).toBe('number')
    expect(await screen.findByTestId('toast')).toHaveTextContent('Published')
    await waitFor(() => expect(tid('portfolio-out-pf-a-repo')).toHaveAttribute('data-status', 'published'))
    expect(tid('portfolio-status-pf-a-repo')).toHaveTextContent('Published')
    expect(tid('portfolio-url-pf-a-repo').textContent).toBe(REPO_URL('pf-a'))
    expect(tid('portfolio-text-pf-a-repo')).toHaveAttribute('readonly')
    expect(has('portfolio-publish-pf-a-repo')).toBe(false)
    expect(await row(d, 'pf-a:site')).toBeUndefined()
  })
  it('a rejected push keeps the dialog open with the code and git\'s message; the row stays a draft', async () => {
    const msg = 'GitHub did not accept the push: ! [rejected] main -> main (fetch first). Dojo never pulls, merges or forces. Fix it in /h/labs/.publish/ai-platform-lab, or delete that folder and publish again.'
    stub({ pub: () => json({ ok: false, error: { code: 'push_failed', message: msg } }, 502) })
    const d = await withDraft('repo')
    click('portfolio-publish-pf-a-repo')
    await waitFor(() => expect(tid('portfolio-confirm-submit')).toBeEnabled())
    click('portfolio-confirm-submit')
    await waitFor(() => expect(has('portfolio-confirm-error')).toBe(true))
    expect(tid('portfolio-confirm-error')).toHaveAttribute('data-code', 'push_failed')
    expect(tid('portfolio-confirm-error-message')).toHaveTextContent(/rejected.*delete/)
    expect(tid('portfolio-confirm-submit')).toBeEnabled() // after the folder is deleted the same dialog can publish again
    expect((await row(d, 'pf-a:repo'))!.status).toBe('draft')
  })
  it('gh missing or signed out: the error shows as soon as the dialog opens, Publish is disabled and no URL is shown', async () => {
    const gh = { ok: false, code: 'gh_not_logged_in', message: 'GitHub CLI is not signed in. Run gh auth login in a terminal, then try again.' }
    stub({ exp: () => ({ gh, urls: [], repoUrl: null }) })
    await withDraft('repo')
    click('portfolio-publish-pf-a-repo')
    await waitFor(() => expect(has('portfolio-confirm-error')).toBe(true))
    expect(tid('portfolio-confirm-error')).toHaveAttribute('data-code', 'gh_not_logged_in')
    expect(tid('portfolio-confirm-error-message').textContent).toBe(gh.message)
    expect(has('portfolio-confirm-url')).toBe(false)
    expect(tid('portfolio-confirm-submit')).toBeDisabled()
  })
  it('an export that fails when the dialog opens shows its error and cannot publish', async () => {
    const d = await withDraft('repo')
    vi.stubGlobal('fetch', vi.fn(async () => json({ ok: false, error: { code: 'gh_missing', message: 'The GitHub CLI (gh) was not found.' } }, 503)))
    click('portfolio-publish-pf-a-repo')
    await waitFor(() => expect(has('portfolio-confirm-error')).toBe(true))
    expect(tid('portfolio-confirm-error')).toHaveAttribute('data-code', 'gh_missing')
    expect(tid('portfolio-confirm-submit')).toBeDisabled()
    expect((await row(d, 'pf-a:repo'))!.status).toBe('draft')
  })
})

describe('Portfolio screen: read-only browser (PORT-47)', () => {
  it('shows saved drafts read-only; create, publish and posted are disabled; Copy still works', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const d = freshDb()
    await seedPort(d)
    await d.portfolioItems.bulkPut([
      { id: 'pf-a:repo', labId: 'pf-a', kind: 'repo', status: 'draft', draft: '# Saved', updatedAt: 1 },
      { id: 'pf-a:linkedin', labId: 'pf-a', kind: 'linkedin', status: 'draft', draft: 'Saved post.', updatedAt: 1 },
    ])
    localStorage.removeItem('dojo.writer')
    renderWithApp(<Portfolio />, { db: d, ...appPlans({}), route: '/portfolio' })
    await screen.findByTestId('portfolio-card-pf-a')
    expect(textOf('portfolio-text-pf-a-repo')).toBe('# Saved')
    expect(tid('portfolio-text-pf-a-repo')).toHaveAttribute('readonly')
    expect(tid('portfolio-text-pf-a-linkedin')).toHaveAttribute('readonly')
    expect(tid('portfolio-publish-pf-a-repo')).toBeDisabled()
    expect(tid('portfolio-posted-pf-a-linkedin')).toBeDisabled()
    for (const k of ['site', 'article']) expect(tid(`portfolio-create-pf-a-${k}`)).toBeDisabled()
    click('portfolio-copy-pf-a-linkedin')
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Saved post.'))
  })
})
