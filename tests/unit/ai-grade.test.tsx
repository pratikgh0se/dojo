import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestGrade } from '../../src/data/gradeActions'
import * as gradeActions from '../../src/data/gradeActions'
import type { ArtifactRecord } from '../../src/rules/artifacts'
import { addUserArtifact, OCT14, projectDb, REPO, renderAi } from '../helpers/projects'

// the Repo folder tests watch the arguments of the one call the dialog makes; the call itself still runs
vi.mock('../../src/data/gradeActions', async importOriginal => {
  const m = await importOriginal<typeof import('../../src/data/gradeActions')>()
  return { ...m, requestGrade: vi.fn(m.requestGrade) }
})
afterEach(() => { vi.mocked(gradeActions.requestGrade).mockClear(); localStorage.removeItem('dojo:grade-repo-folder'); localStorage.removeItem('dojo-ai-fake-fail') })

const NOTE = 'forward/backward on 3 nodes, checked by finite differences'
const S00 = 'Stage 00 · Setup + math by picture'
const cardOf = (title: string) =>
  screen.getAllByTestId('board-card').find(c => within(c).getByTestId('board-card-open').textContent === title) as HTMLElement

async function stage00(graded = false) {
  const d = await projectDb()
  await d.artifacts.update('art-stage-00', { repo: REPO, commit: 'c0ffee1', note: NOTE })
  if (graded) await requestGrade(d, 'art-stage-00', '', () => OCT14)
  await renderAi({ db: d, route: '/ai?artifact=art-stage-00' })
  return { d, dlg: await screen.findByRole('dialog', { name: `Artifact · ${S00}` }) }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('Grade section (C-PROJECTS §2.6)', () => {
  it('is disabled with a reason until a saved repo URL and commit exist (scenario 28)', async () => {
    await renderAi({ route: '/ai?artifact=art-stage-03' })
    const dlg = await screen.findByRole('dialog', { name: 'Artifact · Stage 03 · GPT' })
    expect(within(dlg).getByRole('button', { name: 'Request grade' })).toBeDisabled()
    expect(within(dlg).getByTestId('grade-disabled-reason')).toHaveTextContent('Add a repo URL and a commit to grade.')
  })

  it('G6: with no project repo set it says how to set one; with one (from /db/health) it says nothing', async () => {
    const { dlg } = await stage00()
    expect(within(dlg).getByTestId('grade-project-repo-unset')).toHaveTextContent('Set your project repo to let the grader read your commits: DOJO_PROJECT_REPO')
    expect(within(dlg).getByRole('button', { name: 'Request grade' })).toBeEnabled()
  })

  it('G6: a project repo reported by the server hides the set-your-repo note', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: unknown) => String(u) === '/db/health'
      ? new Response(JSON.stringify({ ok: true, home: '/h', dbPath: '/h/dojo.db', projectRepo: '/srv/learner/forge' }))
      : Promise.reject(new Error('offline'))))
    const { dlg } = await stage00()
    await waitFor(() => expect(within(dlg).queryByTestId('grade-project-repo-unset')).toBeNull())
  })

  it('passes with the fake: loader, 4/5 Passed, feedback, date, commit checked, chip, DONE (scenario 29)', async () => {
    localStorage.setItem('dojo-ai-fake-delay-ms', '60')
    const { dlg } = await stage00()
    fireEvent.click(within(dlg).getByRole('button', { name: 'Request grade' }))
    expect(within(dlg).getByRole('status', { name: 'Grading…' })).toHaveAttribute('data-testid', 'grade-loading')
    expect(within(dlg).getByTestId('grade-request')).toBeDisabled()
    await waitFor(() => expect(within(dlg).getByTestId('grade-score')).toHaveTextContent('4/5'))
    expect(within(dlg).queryByTestId('grade-loading')).toBeNull()
    expect(within(dlg).getByTestId('grade-verdict')).toHaveTextContent('Passed')
    const first = within(within(dlg).getByTestId('grade-feedback')).getAllByRole('listitem')[0]
    expect(first.textContent).toMatch(/^\[fake:grade\]/)
    expect(first).toHaveTextContent('art-stage-00')
    expect(within(dlg).queryByTestId('grade-missing')).toBeNull()
    expect(within(dlg).getByTestId('grade-at')).toHaveTextContent('Graded 14 Oct 2026')
    await waitFor(() => expect(within(dlg).getByTestId('artifact-commit-checked')).toHaveTextContent('Commit checked'))
    expect(within(dlg).getByTestId('artifact-done')).toHaveTextContent('Done')
    expect(within(dlg).getByTestId('grade-request')).toHaveTextContent('Re-grade')
    expect(within(cardOf(S00)).getByTestId('grade-chip')).toHaveTextContent('4/5')
    expect(within(cardOf(S00)).getByTestId('artifact-done-badge')).toBeInTheDocument()
  })

  it('reopening shows the stored result with no loader and no new grade (scenario 31)', async () => {
    const { d, dlg } = await stage00(true)
    expect(within(dlg).queryByTestId('grade-loading')).toBeNull()
    expect(within(dlg).getByTestId('grade-score')).toHaveTextContent('4/5')
    expect(within(dlg).getByRole('button', { name: 'Re-grade' })).toBeEnabled()
    expect(await d.grades.count()).toBe(1)
  })

  it('low: 2/5 Not yet with a Missing list, no DONE, no Prove (scenario 32)', async () => {
    localStorage.setItem('dojo:fake-ai-grade', 'low')
    const d = await projectDb()
    const id = await addUserArtifact(d, { title: 'micrograd engine', stage: 1, repo: REPO, commit: 'a1b2c3d' })
    await renderAi({ db: d, route: `/ai?artifact=${id}` })
    const dlg = await screen.findByRole('dialog', { name: 'Artifact · micrograd engine' })
    fireEvent.click(within(dlg).getByRole('button', { name: 'Request grade' }))
    await waitFor(() => expect(within(dlg).getByTestId('grade-score')).toHaveTextContent('2/5'))
    expect(within(dlg).getByTestId('grade-verdict')).toHaveTextContent('Not yet')
    const missing = within(dlg).getByTestId('grade-missing')
    expect(within(missing).getByRole('heading', { name: 'Missing' })).toBeInTheDocument()
    expect(within(missing).getAllByRole('listitem')[0].textContent).toMatch(/^\[fake:grade\]/)
    expect(within(dlg).queryByTestId('artifact-done')).toBeNull()
    expect(within(cardOf('micrograd engine')).queryByTestId('artifact-done-badge')).toBeNull()
    expect(screen.getByTestId('ai-cube-01-prove')).toHaveAttribute('data-state', 'empty')
  })

  it('unavailable: alert with the raw error and Retry; the stored grade stays; Retry later succeeds (scenario 33)', async () => {
    const { d, dlg } = await stage00(true)
    localStorage.setItem('dojo:fake-ai-grade', 'error')
    fireEvent.click(within(dlg).getByRole('button', { name: 'Re-grade' }))
    const err = await within(dlg).findByTestId('grade-error')
    expect(err).toHaveAttribute('role', 'alert')
    expect(err).toHaveTextContent('Grader unavailable — nothing was saved.')
    expect(within(err).getByText('fake grade unavailable').tagName).toBe('CODE')
    expect(within(dlg).getByTestId('grade-score')).toHaveTextContent('4/5')
    expect(within(dlg).getByTestId('artifact-done')).toBeInTheDocument()
    expect(await d.grades.count()).toBe(1)
    localStorage.removeItem('dojo:fake-ai-grade')
    fireEvent.click(within(dlg).getByTestId('grade-retry'))
    await waitFor(() => expect(within(dlg).queryByTestId('grade-error')).toBeNull())
    await waitFor(async () => expect(await d.grades.count()).toBe(2))
  })

  it('a result that lands after the dialog closed is still stored (Review Focus #4)', async () => {
    localStorage.setItem('dojo-ai-fake-delay-ms', '80')
    const { d, dlg } = await stage00()
    fireEvent.click(within(dlg).getByRole('button', { name: 'Request grade' }))
    fireEvent.keyDown(dlg, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(async () => expect(((await d.artifacts.get('art-stage-00')) as ArtifactRecord).grade).toBe(4))
    fireEvent.click(within(cardOf(S00)).getByTestId('board-card-open'))
    const again = await screen.findByRole('dialog', { name: `Artifact · ${S00}` })
    expect(within(again).getByRole('button', { name: 'Re-grade' })).toBeInTheDocument()
  })

  it('stays disabled for that artifact after the dialog is closed and reopened mid-request (chain P task 5)', async () => {
    localStorage.setItem('dojo-ai-fake-delay-ms', '80')
    const { dlg } = await stage00()
    fireEvent.click(within(dlg).getByRole('button', { name: 'Request grade' }))
    expect(within(dlg).getByTestId('grade-request')).toBeDisabled()
    fireEvent.keyDown(dlg, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(within(cardOf(S00)).getByTestId('board-card-open'))
    const again = await screen.findByRole('dialog', { name: `Artifact · ${S00}` })
    expect(within(again).getByTestId('grade-request')).toBeDisabled()
    await waitFor(() => expect(within(again).getByTestId('grade-request')).toBeEnabled())
    expect(within(again).getByTestId('grade-score')).toHaveTextContent('4/5')
  })

  it('the commit summary field exists only after its toggle, so "Commit" labels one field (spec P-10)', async () => {
    const { dlg } = await stage00()
    expect(within(dlg).getAllByLabelText(/Commit/)).toHaveLength(1)
    fireEvent.click(within(dlg).getByRole('button', { name: 'Add commit summary' }))
    const summary = within(dlg).getByLabelText('Commit summary')
    expect(document.activeElement).toBe(summary)
    expect(within(dlg).getAllByLabelText(/Commit/)).toHaveLength(2)
  })

  describe('the Repo folder (UAT cu-5 P2-3)', () => {
    const PROJECT = '/srv/learner/forge' // the learner's DOJO_PROJECT_REPO, as /db/health reports it (G6: the field exists only then)
    const folderOf = (dlg: HTMLElement) => within(dlg).getByLabelText('Repo folder') as HTMLInputElement
    const lastFolder = () => vi.mocked(gradeActions.requestGrade).mock.calls.at(-1)?.[5]
    async function withProject() {
      vi.stubGlobal('fetch', vi.fn(async (u: unknown) => String(u) === '/db/health'
        ? new Response(JSON.stringify({ ok: true, home: '/h', dbPath: '/h/dojo.db', projectRepo: PROJECT }))
        : Promise.reject(new Error('offline'))))
      const r = await stage00()
      await within(r.dlg).findByLabelText('Repo folder')
      return r
    }

    it('G6: with no project repo set there is no Repo folder field and the request sends none', async () => {
      const { dlg } = await stage00()
      expect(within(dlg).queryByLabelText('Repo folder')).toBeNull()
      fireEvent.click(within(dlg).getByRole('button', { name: 'Request grade' }))
      await waitFor(() => expect(within(dlg).getByTestId('grade-score')).toBeInTheDocument())
      expect(lastFolder()).toBe('')
    })

    it('starts at the project repo, says what it is for, and the request carries it', async () => {
      const { dlg } = await withProject()
      expect(folderOf(dlg).value).toBe(PROJECT)
      expect(within(dlg).getByTestId('grade-repo-folder-help')).toHaveTextContent('read-only')
      fireEvent.click(within(dlg).getByRole('button', { name: 'Request grade' }))
      await waitFor(() => expect(within(dlg).getByTestId('grade-score')).toBeInTheDocument())
      expect(lastFolder()).toBe(PROJECT)
    })

    it('a folder outside the project repo is refused on the spot, before any call, and the rule is stated', async () => {
      const { dlg } = await withProject()
      fireEvent.change(folderOf(dlg), { target: { value: '~/Documents' } })
      expect(within(dlg).getByTestId('grade-repo-folder-error')).toHaveTextContent(`The Repo folder must be ${PROJECT} or a folder inside it.`)
      expect(folderOf(dlg)).toHaveAttribute('aria-invalid', 'true')
      fireEvent.click(within(dlg).getByRole('button', { name: 'Request grade' }))
      expect(document.activeElement).toBe(folderOf(dlg)) // the click lands on the field to fix
      expect(gradeActions.requestGrade).not.toHaveBeenCalled()
      expect(within(dlg).queryByTestId('grade-loading')).toBeNull()
      fireEvent.change(folderOf(dlg), { target: { value: `${PROJECT}/stages/01-micrograd` } })
      expect(within(dlg).queryByTestId('grade-repo-folder-error')).toBeNull()
    })

    it('is remembered on this Mac: a valid change is kept for the next artifact, an invalid one is not', async () => {
      const { dlg } = await withProject()
      fireEvent.change(folderOf(dlg), { target: { value: `${PROJECT}/stages` } })
      expect(localStorage.getItem('dojo:grade-repo-folder')).toBe(`${PROJECT}/stages`)
      fireEvent.change(folderOf(dlg), { target: { value: '/tmp' } })
      expect(localStorage.getItem('dojo:grade-repo-folder')).toBe(`${PROJECT}/stages`)
      fireEvent.change(folderOf(dlg), { target: { value: '' } }) // no local read is a choice too
      expect(localStorage.getItem('dojo:grade-repo-folder')).toBe('')
    })

    it('a remembered folder comes back, and a cleared one sends no repoPath', async () => {
      localStorage.setItem('dojo:grade-repo-folder', '')
      const { dlg } = await withProject()
      expect(folderOf(dlg).value).toBe('')
      fireEvent.click(within(dlg).getByRole('button', { name: 'Request grade' }))
      await waitFor(() => expect(within(dlg).getByTestId('grade-score')).toBeInTheDocument())
      expect(lastFolder()).toBe('')
    })

    it('when the helper refuses the folder, the alert says what to fix, then the raw error, and Retry works once it is fixed', async () => {
      const { dlg } = await withProject()
      localStorage.setItem('dojo-ai-fake-fail', 'grade:path_not_allowed')
      fireEvent.click(within(dlg).getByRole('button', { name: 'Request grade' }))
      const err = await within(dlg).findByTestId('grade-error')
      expect(err).toHaveTextContent('Grader unavailable — nothing was saved.')
      expect(within(err).getByTestId('grade-error-fix')).toHaveTextContent(`The Repo folder must be ${PROJECT} or a folder inside it. Fix the Repo folder above, then Retry.`)
      expect(within(err).getByRole('button', { name: 'Retry' })).toBeInTheDocument()
      localStorage.removeItem('dojo-ai-fake-fail')
      fireEvent.click(within(err).getByRole('button', { name: 'Retry' }))
      await waitFor(() => expect(within(dlg).getByTestId('grade-score')).toHaveTextContent('4/5'))
      expect(within(dlg).queryByTestId('grade-error')).toBeNull()
    })

    it('a repo with no remote cannot be graded yet, and the dialog says so; with a URL and a commit the note is gone', async () => {
      const d = await projectDb()
      await renderAi({ db: d, route: '/ai?artifact=art-stage-03' })
      const dlg = await screen.findByRole('dialog', { name: 'Artifact · Stage 03 · GPT' })
      expect(within(dlg).getByRole('button', { name: 'Request grade' })).toBeDisabled()
      expect(within(dlg).getByTestId('grade-disabled-reason')).toHaveTextContent('Add a repo URL and a commit to grade.')
      expect(within(dlg).getByTestId('grade-remote-note')).toHaveTextContent('a repo with no remote yet cannot be graded')
      expect(within(dlg).getByTestId('grade-remote-note')).toHaveTextContent('git remote add origin')
    })

    it('with a repo URL but no commit yet, only the pinned reason shows', async () => {
      const d = await projectDb()
      await d.artifacts.update('art-stage-03', { repo: REPO })
      await renderAi({ db: d, route: '/ai?artifact=art-stage-03' })
      const dlg = await screen.findByRole('dialog', { name: 'Artifact · Stage 03 · GPT' })
      expect(within(dlg).getByTestId('grade-disabled-reason')).toBeInTheDocument()
      expect(within(dlg).queryByTestId('grade-remote-note')).toBeNull()
    })
  })
})
