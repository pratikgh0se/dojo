import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { viteBuild } from '../../../scripts/install-app.mjs'
import { openApp } from './briefs-helpers'
import { ServerHarness } from './harness'

// UAT cu-5 P2-3: "Request grade" through the real helper (the app's own server, a stub CLI standing in for `claude`) against a
// throwaway git repo at projects/forge in a throwaway account home, set as the server's DOJO_PROJECT_REPO (G6). The server's data home is a different folder, as in the
// app (~/Dojo), which is what made every grade fail with "repoPath must be ... or inside it".
// No real repo and not ~/Dojo are touched.
test.describe.configure({ timeout: 180_000 })

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  }).trim()

const SUBJECT = 'micrograd engine: Value with a hand-written backward pass'
let dist: string
let work: string
let accountHome: string
let sha: string
let project: string
let promptFile: string
let srv: ServerHarness

test.beforeAll(() => {
  // the app's own build: its page talks to the server's helper routes instead of the page's fake AI
  dist = mkdtempSync(join(tmpdir(), 'dojo-grade-dist-'))
  viteBuild(dist, { desktop: true })
})
test.afterAll(() => { rmSync(dist, { recursive: true, force: true }) })

test.beforeEach(async () => {
  work = realpathSync(mkdtempSync(join(tmpdir(), 'dojo-grade-')))
  accountHome = join(work, 'account')
  const forge = join(accountHome, 'projects', 'forge')
  project = forge
  mkdirSync(join(forge, 'stages', '01-micrograd'), { recursive: true })
  git(work, 'init', '-q', forge)
  writeFileSync(join(forge, 'stages', '01-micrograd', 'engine.py'), 'class Value: pass\n')
  git(forge, 'add', '.')
  git(forge, 'commit', '-q', '-m', SUBJECT)
  sha = git(forge, 'rev-parse', '--short', 'HEAD')
  mkdirSync(join(accountHome, 'projects', 'notes'), { recursive: true })
  // the stub CLI: saves the prompt it is given and answers with a valid grade
  const bin = join(work, 'claude')
  promptFile = join(work, 'prompt.txt')
  const reply = { type: 'result', result: JSON.stringify({ score: 4, max: 5, passed: true, feedback: ['The engine runs and the backward pass is written by hand.'], missing: [], commitFound: true }) }
  writeFileSync(join(work, 'reply.json'), JSON.stringify(reply))
  writeFileSync(bin, `#!/bin/sh\ncat > '${promptFile}'\ncat '${join(work, 'reply.json')}'\n`)
  chmodSync(bin, 0o755)
  srv = new ServerHarness(undefined, { HOME: accountHome, DOJO_PROJECT_REPO: project, DOJO_CLAUDE_BIN: bin, PATH: process.env.PATH ?? '' }, { args: [], dist })
  await srv.start()
})
test.afterEach(async () => {
  await srv.dispose()
  rmSync(work, { recursive: true, force: true })
})

async function openGradeDialog(page: Page, repoUrl: string, commit: string) {
  await page.goto('/ai')
  await page.getByRole('button', { name: 'Add artifact' }).click()
  const add = page.getByRole('dialog', { name: 'New artifact' })
  await add.getByLabel('Title', { exact: true }).fill('micrograd engine')
  await add.getByLabel('Stage', { exact: true }).selectOption({ label: 'Stage 01' })
  await add.getByLabel('Repo URL', { exact: true }).fill(repoUrl)
  await add.getByLabel('Commit', { exact: true }).fill(commit)
  await add.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(add).toBeHidden()
  await page.getByTestId('board-card').filter({ hasText: 'micrograd engine' }).getByTestId('board-card-open').click()
  const dlg = page.getByRole('dialog', { name: 'Artifact · micrograd engine' })
  await expect(dlg).toBeVisible()
  return dlg
}

test('Request grade reads the commit from the project repo although the data home is somewhere else; a bad folder is said, not tried', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  expect(existsSync(srv.home)).toBe(true)
  expect(srv.home).not.toContain(accountHome) // the data home is not the account home
  const dlg = await openGradeDialog(page, 'https://github.com/me/forge', sha)

  // the folder: the forge repo until changed
  const folder = dlg.getByLabel('Repo folder')
  await expect(folder).toHaveValue(project)
  await dlg.getByTestId('grade-request').click()
  await expect(dlg.getByTestId('grade-score')).toHaveText('4/5')
  await expect(dlg.getByTestId('grade-verdict')).toHaveText('Passed')
  await expect(dlg.getByTestId('grade-error')).toHaveCount(0)
  // the helper really read the learner's repo: its log and the named commit are in what the model was given
  const prompt = readFileSync(promptFile, 'utf8')
  expect(prompt).toContain('$ git log --oneline -n 20')
  expect(prompt).toContain(SUBJECT)
  expect(prompt).toContain(`$ git show --stat ${sha}`)
  expect(prompt).toContain('stages/01-micrograd/engine.py')

  // a folder outside the forge repo is refused before any call, and says what to fix
  rmSync(promptFile)
  await folder.fill('~/Documents')
  await expect(dlg.getByTestId('grade-repo-folder-error')).toHaveText(`The Repo folder must be ${project} or a folder inside it.`)
  await dlg.getByTestId('grade-request').click()
  await expect(folder).toBeFocused()
  expect(existsSync(promptFile)).toBe(false)

  // a folder the client accepts but the Mac does not have: the helper says so, and the alert tells the learner what to do
  await folder.fill(`${project}/not-there`)
  await dlg.getByTestId('grade-request').click()
  const err = dlg.getByTestId('grade-error')
  await expect(err).toContainText('Grader unavailable — nothing was saved.')
  await expect(dlg.getByTestId('grade-error-fix')).toContainText('That Repo folder does not exist on this Mac')
  await expect(err).toContainText('is not a folder on this Mac')
  // the earlier grade is still there
  await expect(dlg.getByTestId('grade-score')).toHaveText('4/5')
  // fixing the folder and pressing Retry grades again
  await folder.fill(`${project}/stages`)
  await dlg.getByTestId('grade-retry').click()
  await expect(dlg.getByTestId('grade-error')).toHaveCount(0)
  await expect.poll(() => existsSync(promptFile)).toBe(true)
  await ctx.close()
})

test('the folder the learner chose is remembered: it is there again after a reload', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  const dlg = await openGradeDialog(page, 'https://github.com/me/forge', sha)
  const folder = dlg.getByLabel('Repo folder')
  await folder.fill(`${project}/stages`)
  await dlg.getByTestId('grade-request').click()
  await expect(dlg.getByTestId('grade-score')).toHaveText('4/5')
  await page.reload() // the open artifact is in the URL (?artifact=<id>), so its dialog is back
  await expect(page.getByRole('dialog', { name: 'Artifact · micrograd engine' }).getByLabel('Repo folder')).toHaveValue(`${project}/stages`)
  await ctx.close()
})
