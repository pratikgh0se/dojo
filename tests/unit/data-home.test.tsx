import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { dataFile, fetchDataHome, homeRelative, shownDataFile } from '../../src/data/dataHome'
import { Backups } from '../../src/screens/Backups'
import { ToastProvider } from '../../src/ui/primitives'

// Controller ruling 3 (8): Settings shows the data directory the server reports, never a hard-coded ~/Dojo.
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })

describe('data home (GET /db/health `home`)', () => {
  it('reads home and dbPath; the file shown is dbPath, else <home>/dojo.db', async () => {
    const f = (async () => json({ ok: true, home: '/Users/p/DojoTest', dbPath: '/Users/p/DojoTest/dojo.db' })) as typeof fetch
    const h = await fetchDataHome(f)
    expect(h).toEqual({ home: '/Users/p/DojoTest', dbPath: '/Users/p/DojoTest/dojo.db', projectRepo: null })
    // G6: the learner's project repo (DOJO_PROJECT_REPO / profile.json) when the server has one
    const g = (async () => json({ ok: true, home: '/h', dbPath: '/h/dojo.db', projectRepo: '/Users/l/projects/forge' })) as typeof fetch
    expect((await fetchDataHome(g))?.projectRepo).toBe('/Users/l/projects/forge')
    expect(dataFile({ home: '/srv/dojo/', dbPath: '' })).toBe('/srv/dojo/dojo.db')
  })

  it('is null when the server is down or says nothing useful', async () => {
    expect(await fetchDataHome((async () => json({}, 503)) as typeof fetch)).toBeNull()
    expect(await fetchDataHome((async () => { throw new Error('down') }) as typeof fetch)).toBeNull()
    expect(await fetchDataHome((async () => json({ ok: true })) as typeof fetch)).toBeNull()
  })

  it('Backups names the reported data file, not ~/Dojo', async () => {
    const fetcher = (async (u: RequestInfo | URL) =>
      String(u) === '/db/health' ? json({ ok: true, home: '/tmp/dojo-x', dbPath: '/tmp/dojo-x/dojo.db' }) : json({ backups: [] })) as typeof fetch
    render(<ToastProvider><Backups fetcher={fetcher} /></ToastProvider>)
    await waitFor(() => expect(screen.getByTestId('data-home')).toHaveTextContent('Your progress lives in /tmp/dojo-x/dojo.db.'))
    expect(screen.queryByText(/~\/Dojo/)).toBeNull()
  })
})

// Ruling 23 K5 (UAT cu-1 P3-15): paths in Settings read home-relative.
describe('home-relative paths', () => {
  it('a path inside the user\'s home is ~/…; one outside it stays absolute', () => {
    expect(homeRelative('/Users/learner/Dojo/dojo.db', '/Users/learner')).toBe('~/Dojo/dojo.db')
    expect(homeRelative('/Users/learner/Dojo/dojo.db', '/Users/learner/')).toBe('~/Dojo/dojo.db')
    expect(homeRelative('/Users/learner', '/Users/learner')).toBe('~')
    expect(homeRelative('/tmp/dojo-x/dojo.db', '/Users/learner')).toBe('/tmp/dojo-x/dojo.db')
    // a sibling that merely starts with the same letters is not inside it
    expect(homeRelative('/Users/learner2/Dojo/dojo.db', '/Users/learner')).toBe('/Users/learner2/Dojo/dojo.db')
    expect(homeRelative('/Dojo/dojo.db', '/')).toBe('/Dojo/dojo.db')
  })

  it('without the server\'s userHome a macOS or Linux home is recognised by its shape', () => {
    expect(homeRelative('/Users/learner/Dojo/dojo.db')).toBe('~/Dojo/dojo.db')
    expect(homeRelative('/home/p/Dojo/dojo.db')).toBe('~/Dojo/dojo.db')
    expect(homeRelative('/srv/dojo/dojo.db')).toBe('/srv/dojo/dojo.db')
  })

  it('reads userHome from /db/health; the shown file is home-relative', async () => {
    const f = (async () => json({ ok: true, home: '/Users/p/Dojo', dbPath: '/Users/p/Dojo/dojo.db', userHome: '/Users/p' })) as typeof fetch
    const h = (await fetchDataHome(f))!
    expect(h.userHome).toBe('/Users/p')
    expect(dataFile(h)).toBe('/Users/p/Dojo/dojo.db') // the real file is still the absolute path
    expect(shownDataFile(h)).toBe('~/Dojo/dojo.db')
    expect(shownDataFile({ home: '/Users/p/Dojo/', dbPath: '', userHome: '/Users/p' })).toBe('~/Dojo/dojo.db')
  })

  it('Backups and Settings\' Storage line show ~/Dojo/dojo.db', async () => {
    const fetcher = (async (u: RequestInfo | URL) =>
      String(u) === '/db/health' ? json({ ok: true, home: '/Users/p/Dojo', dbPath: '/Users/p/Dojo/dojo.db', userHome: '/Users/p' }) : json({ backups: [] })) as typeof fetch
    render(<ToastProvider><Backups fetcher={fetcher} /></ToastProvider>)
    await waitFor(() => expect(screen.getByTestId('data-home')).toHaveTextContent('Your progress lives in ~/Dojo/dojo.db.'))
    expect(screen.getByTestId('data-home').textContent).not.toContain('/Users/')
  })

  it('Settings shows the data file as ~/Dojo/dojo.db, with no absolute home path anywhere', async () => {
    const { vi } = await import('vitest')
    const { Settings } = await import('../../src/screens/Settings')
    const { seededDb } = await import('../helpers/db')
    const { smallPlan } = await import('../helpers/plan')
    const { renderWithApp } = await import('../helpers/render')
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation((async (u: RequestInfo | URL) =>
      String(u) === '/db/health' ? json({ ok: true, home: '/Users/p/Dojo', dbPath: '/Users/p/Dojo/dojo.db', userHome: '/Users/p' }) : json({ backups: [] })) as typeof fetch)
    try {
      renderWithApp(<Settings />, { db: await seededDb(), plan: smallPlan, route: '/settings' })
      await waitFor(() => expect(screen.getByTestId('data-home')).toHaveTextContent('~/Dojo/dojo.db'))
      expect(document.body.textContent).not.toMatch(/\/Users\/p\b/)
    } finally {
      spy.mockRestore()
    }
  })
})

describe('Settings asks /db/health once (G4 review 7)', () => {
  it('Storage and Backups share one health fetch, both showing the reported file', async () => {
    const { vi } = await import('vitest')
    const { Settings } = await import('../../src/screens/Settings')
    const { seededDb } = await import('../helpers/db')
    const { smallPlan } = await import('../helpers/plan')
    const { renderWithApp } = await import('../helpers/render')
    const calls: string[] = []
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation((async (u: RequestInfo | URL) => {
      calls.push(String(u))
      return String(u) === '/db/health' ? json({ ok: true, home: '/tmp/dh', dbPath: '/tmp/dh/dojo.db' }) : json({ backups: [] })
    }) as typeof fetch)
    try {
      renderWithApp(<Settings />, { db: await seededDb(), plan: smallPlan, route: '/settings' })
      await waitFor(() => expect(screen.getByTestId('data-home')).toHaveTextContent('/tmp/dh/dojo.db'))
      expect(calls.filter(c => c === '/db/health')).toHaveLength(1)
    } finally {
      spy.mockRestore()
    }
  })
})
