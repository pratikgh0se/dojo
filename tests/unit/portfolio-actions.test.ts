import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDraft, itemId, markPublished, saveDraft } from '../../src/data/portfolioActions'
import { freshDb } from '../helpers/db'
import { WRITEUPS, REPO_URL, exportReply, seedPort, USER } from '../helpers/portfolioFixture'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const server = (over: Record<string, Record<string, unknown>> = {}) => vi.fn(async (_url: string, init?: RequestInit) => {
  const b = JSON.parse(String(init?.body)) as { labId: 'pf-a' | 'pf-b' }
  return json(exportReply(b.labId, over[b.labId]))
}) as unknown as typeof fetch
afterEach(() => localStorage.clear())
const norm = (s: string) => s.split('\n').map(l => l.trimEnd()).join('\n').trimEnd()

describe('saveDraft / markPublished', () => {
  it('one row per lab and kind keyed <labId>:<kind>; a save makes it a draft and bumps updatedAt', async () => {
    const d = freshDb()
    expect(itemId('pf-a', 'repo')).toBe('pf-a:repo')
    expect(await saveDraft(d, 'pf-a', 'repo', '# One\n', 10)).toEqual({ id: 'pf-a:repo', labId: 'pf-a', kind: 'repo', status: 'draft', draft: '# One\n', updatedAt: 10 })
    await saveDraft(d, 'pf-a', 'repo', '# Two\n', 20)
    expect(await d.portfolioItems.count()).toBe(1)
    expect(await d.portfolioItems.get('pf-a:repo')).toMatchObject({ draft: '# Two\n', updatedAt: 20, status: 'draft' })
  })
  it('markPublished records the time and url; a LinkedIn post gets no url', async () => {
    const d = freshDb()
    await saveDraft(d, 'pf-a', 'article', '# A\n', 10)
    expect(await markPublished(d, 'pf-a', 'article', 30, 'https://u.github.io/x/writing/pf-a')).toMatchObject({ status: 'published', publishedAt: 30, url: 'https://u.github.io/x/writing/pf-a', draft: '# A\n' })
    const li = await markPublished(d, 'pf-a', 'linkedin', 50)
    expect(li).toMatchObject({ id: 'pf-a:linkedin', status: 'published', publishedAt: 50 })
    expect('url' in li).toBe(false)
  })
})

describe('createDraft: repo and site (no AI)', () => {
  it('PORT-20: only the site draft asks the server for the GitHub login; the repo draft does not', async () => {
    const d = freshDb(); await seedPort(d)
    const f = server()
    await createDraft(d, 'pf-a', 'repo', 1000, f)
    await createDraft(d, 'pf-a', 'site', 1001, f)
    const sent = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls.map(c => JSON.parse(String(c[1].body)) as { login?: boolean })
    expect(sent.map(b => b.login)).toEqual([false, true])
  })
  it('pf-a repo: the README of the contract, hint line first, from the write-up at HEAD, with the stored row shape', async () => {
    const d = freshDb(); await seedPort(d)
    const f = server()
    const r = await createDraft(d, 'pf-a', 'repo', 1000, f)
    expect(r.ok).toBe(true)
    const row = await d.portfolioItems.get('pf-a:repo')
    expect(row).toMatchObject({ id: 'pf-a:repo', labId: 'pf-a', kind: 'repo', status: 'draft', updatedAt: 1000 })
    expect('publishedAt' in row!).toBe(false)
    expect('url' in row!).toBe(false)
    expect(norm(row!.draft)).toBe(norm(`Built with reference hints on Fixture A first step, Fixture A second step.

# Portfolio fixture lab A

## Problem
Find the smallest number that passes the fixture check.

## Approach
Start with brute force, then use a closed form.

## Results
The fixture check passes in 0.4 seconds.

| Check | Result | Detail |
|---|---|---|
| Parses input | pass | 12 cases |
| Finds the answer | pass | 0.4 s |

Measured on 2026-11-02.

## What I would change
Add a larger input.

## How to run
\`make check\``))
    expect(await d.aiLog.count()).toBe(0)
    const body = JSON.parse(String((f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0][1].body))
    expect(body).toEqual({ labId: 'pf-a', labsRoot: '~/labs', login: false }) // the lab's stored root; nothing else is sent
  })
  it('pf-b repo: no hint line (rungs 1 and 2 do not count), no table, no date', async () => {
    const d = freshDb(); await seedPort(d)
    await createDraft(d, 'pf-b', 'repo', 1, server())
    const t = (await d.portfolioItems.get('pf-b:repo'))!.draft
    expect(t.startsWith('# Portfolio fixture lab B\n')).toBe(true)
    expect(t).not.toContain('Built with reference hints')
    expect(t).not.toContain('| Check |')
    expect(t).not.toContain('Measured on')
  })
  it('the site page: Code link with the login; the Article line only when the article is published (PORT-09, PORT-39)', async () => {
    const d = freshDb(); await seedPort(d)
    await createDraft(d, 'pf-a', 'site', 1, server())
    const a = (await d.portfolioItems.get('pf-a:site'))!.draft
    expect(a.endsWith(`## Links\n- Code: ${REPO_URL('pf-a')}\n`)).toBe(true)
    expect(a).toContain('## Measured numbers\n\n| Check | Result | Detail |')
    await markPublished(d, 'pf-b', 'article', 5, `https://${USER}.github.io/ai-infra-portfolio/writing/pf-b`)
    await createDraft(d, 'pf-b', 'site', 6, server())
    const b = (await d.portfolioItems.get('pf-b:site'))!.draft
    expect(b).not.toContain('## Measured numbers')
    expect(b.endsWith(`- Code: ${REPO_URL('pf-b')}\n- Article: https://${USER}.github.io/ai-infra-portfolio/writing/pf-b\n`)).toBe(true)
  })
  it('the site page needs a signed-in gh (PORT-19); the repo draft does not; nothing is written on a failure', async () => {
    const d = freshDb(); await seedPort(d)
    const gh = { ok: false, code: 'gh_not_logged_in', message: 'GitHub CLI is not signed in. Run gh auth login in a terminal, then try again.' }
    const f = server({ 'pf-a': { gh, urls: [], repoUrl: null } })
    expect(await createDraft(d, 'pf-a', 'site', 1, f)).toEqual({ ok: false, code: 'gh_not_logged_in', message: gh.message })
    expect(await d.portfolioItems.count()).toBe(0)
    expect((await createDraft(d, 'pf-a', 'repo', 1, f)).ok).toBe(true)
  })
  it('a server error (not_set_up) is returned and nothing is written; a lab that is not Proven or not set up has no draft', async () => {
    const d = freshDb(); await seedPort(d)
    const f = vi.fn(async () => json({ ok: false, error: { code: 'not_set_up', message: 'The lab folder was not found, so set up the lab again.' } }, 409)) as unknown as typeof fetch
    expect(await createDraft(d, 'pf-a', 'repo', 1, f)).toMatchObject({ ok: false, code: 'not_set_up' })
    expect(await d.portfolioItems.count()).toBe(0)
    expect(await createDraft(d, 'pf-c', 'repo', 1, f)).toMatchObject({ ok: false, code: 'not_proven' })
    expect(await createDraft(d, 'nope', 'repo', 1, f)).toMatchObject({ ok: false, code: 'not_set_up' })
    expect(f).toHaveBeenCalledTimes(1)
  })
})

describe('createDraft: article and linkedin (fake AI)', () => {
  it('pf-a article: hint line, blank line, then the contract template (n 2, m 3); one aiLog row', async () => {
    const d = freshDb(); await seedPort(d)
    const r = await createDraft(d, 'pf-a', 'article', 5, server())
    expect(r.ok && r.text).toBe('Built with reference hints on Fixture A first step, Fixture A second step.\n\n# Portfolio fixture lab A\n\nFake article draft built from the write-up, 2 journal entries and 3 stronger versions.')
    expect(await d.portfolioItems.get('pf-a:article')).toMatchObject({ status: 'draft', updatedAt: 5 })
    expect(await d.aiLog.toArray()).toMatchObject([{ job: 'portfolio_draft', provider: 'fake', ok: true, ticketId: 'pf-a' }])
  })
  it('pf-b article: no hint line, n 0, m 2', async () => {
    const d = freshDb(); await seedPort(d)
    const r = await createDraft(d, 'pf-b', 'article', 5, server())
    expect(r.ok && r.text).toBe('# Portfolio fixture lab B\n\nFake article draft built from the write-up, 0 journal entries and 2 stronger versions.')
  })
  it('linkedin: the sentence over m, never the hint line; FAKE-LONG is trimmed at sentence 29 (1,275 characters)', async () => {
    const d = freshDb(); await seedPort(d)
    const r = await createDraft(d, 'pf-a', 'linkedin', 5, server())
    expect(r.ok && r.text).toBe('Fake LinkedIn draft for Portfolio fixture lab A. Built from the write-up and 3 stronger versions.')
    const f = server({ 'pf-a': { writeup: `${WRITEUPS['pf-a']}\nFAKE-LONG\n` } })
    const long = await createDraft(d, 'pf-a', 'linkedin', 6, f)
    expect(long.ok && long.text).toHaveLength(1275)
    expect(long.ok && long.text.endsWith('Sentence 29 of the fake long LinkedIn post.')).toBe(true)
    expect((await d.portfolioItems.get('pf-a:linkedin'))!.draft).toHaveLength(1275)
  })
  it('FAKE-INVALID: the invalid-reply failure, no row, aiLog ok false; reading the write-up again lets a retry succeed (PORT-14)', async () => {
    const d = freshDb(); await seedPort(d)
    const bad = server({ 'pf-a': { writeup: `${WRITEUPS['pf-a']}\nFAKE-INVALID\n` } })
    const r = await createDraft(d, 'pf-a', 'article', 5, bad)
    expect(r).toMatchObject({ ok: false, code: 'invalid_output', message: 'The AI returned something unusable.' })
    expect(await d.portfolioItems.count()).toBe(0)
    expect(await d.aiLog.toArray()).toMatchObject([{ job: 'portfolio_draft', ok: false }])
    expect((await createDraft(d, 'pf-a', 'article', 6, server())).ok).toBe(true)
  })
})
