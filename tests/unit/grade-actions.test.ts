import { describe, expect, it } from 'vitest'
import type { DojoDB } from '../../src/data/db'
import { recordGrade, requestGrade } from '../../src/data/gradeActions'
import { ensureSeedArtifacts } from '../../src/data/projectActions'
import type { ArtifactRecord } from '../../src/rules/artifacts'
import { commitCheckText, GRADE_DISABLED_REASON, GRADE_RUBRIC, gradeFix, gradeFolderRule, gradeRequest, gradeView, PROJECT_REPO_UNSET, repoFolderProblem } from '../../src/rules/grade'
import { freshDb } from '../helpers/db'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const T0 = ist('2026-10-14T10:00:00')
const REPO = 'https://github.com/example-user/forge'
const LOCAL = '/home/learner/projects/forge' // the learner's DOJO_PROJECT_REPO, as /db/health reports it
const NOTE = 'forward/backward on 3 nodes, checked by finite differences'
const get = async (d: DojoDB, id: string) => (await d.artifacts.get(id)) as ArtifactRecord

async function gradable(p: Partial<ArtifactRecord> = {}): Promise<DojoDB> {
  const d = freshDb()
  await ensureSeedArtifacts(d, T0)
  await d.artifacts.update('art-stage-00', { repo: REPO, commit: 'c0ffee1', note: NOTE, ...p })
  return d
}

describe('gradeRequest and views (C-PROJECTS §2.6)', () => {
  it('sends artifact id, title, stage number and title, proof note, repo, commit, commit summary and the §2.6 rubric', async () => {
    const d = await gradable()
    expect(gradeRequest(await get(d, 'art-stage-00'), ' 3 files changed ', LOCAL)).toEqual({
      ticket: { id: 'art-stage-00', title: 'Stage 00 · Setup + math by picture', track: 'ai', text: NOTE },
      context: {
        proofNote: NOTE, repoUrl: REPO, repoPath: LOCAL, commit: 'c0ffee1',
        commitSummary: '3 files changed', stage: 0, stageTitle: 'Setup + math by picture', rubric: GRADE_RUBRIC,
      },
    })
  })

  it('sends no repoPath when the repo URL does not name the local project repo', async () => {
    const d = await gradable({ repo: 'https://github.com/someone/other-project' })
    expect(gradeRequest(await get(d, 'art-stage-00'), '', LOCAL).context.repoPath).toBeUndefined()
  })

  it('G6: sends no repoPath when no project repo is set (DOJO_PROJECT_REPO unset, the default)', async () => {
    const d = await gradable()
    expect(gradeRequest(await get(d, 'art-stage-00')).context.repoPath).toBeUndefined()
    expect(gradeRequest(await get(d, 'art-stage-00'), '', null).context.repoPath).toBeUndefined()
  })

  it('matches the project repo by name under any owner, with or without a trailing slash or .git', async () => {
    for (const repo of [
      'https://github.com/anyone-else/forge',
      'https://github.com/anyone-else/forge/',
      'https://github.com/anyone-else/forge.git',
    ]) {
      const d = await gradable({ repo })
      expect(gradeRequest(await get(d, 'art-stage-00'), '', LOCAL).context.repoPath).toBe(LOCAL)
      expect(gradeRequest(await get(d, 'art-stage-00'), '', `${LOCAL}/`).context.repoPath).toBe(`${LOCAL}/`)
    }
  })

  it('UAT cu-5 P2-3: the Repo folder the learner gives is the repoPath; an empty one sends none (the grade rests on the summary)', async () => {
    const d = await gradable({ repo: 'https://github.com/someone/other-project' })
    const a = await get(d, 'art-stage-00')
    expect(gradeRequest(a, '', LOCAL, `${LOCAL}/stages`).context.repoPath).toBe(`${LOCAL}/stages`)
    expect(gradeRequest(a, '', LOCAL, ` ${LOCAL} `).context.repoPath).toBe(LOCAL)
    expect(gradeRequest(a, 'x', LOCAL, '').context.repoPath).toBeUndefined()
    const named = await get(await gradable(), 'art-stage-00')
    expect(gradeRequest(named, '', LOCAL, '').context.repoPath).toBeUndefined() // clearing the folder wins over the URL's guess
    expect(gradeRequest(named, '', LOCAL).context.repoPath).toBe(LOCAL) // no folder given: the URL's guess
  })

  it('UAT cu-5 P2-3 + G6: a folder is valid when it is the project repo or inside it, or empty; with no project repo any folder is refused', () => {
    for (const ok of ['', '  ', LOCAL, `${LOCAL}/`, `${LOCAL}/stages/01`]) {
      expect(repoFolderProblem(ok, LOCAL), ok).toBeNull()
    }
    for (const bad of ['~', '~/Documents', '/home/learner', '/home/learner/projects', `${LOCAL}ry`, `${LOCAL}/../other`, '/etc', 'projects/forge', `${LOCAL}\\..\\x`]) {
      expect(repoFolderProblem(bad, LOCAL), bad).toBe(gradeFolderRule(LOCAL))
    }
    expect(repoFolderProblem('', null)).toBeNull()
    expect(repoFolderProblem(LOCAL, null)).toBe(PROJECT_REPO_UNSET)
  })

  it('UAT cu-5 P2-3: a failed grade says what to fix', () => {
    const rule = `The Repo folder must be ${LOCAL} or a folder inside it. Fix the Repo folder above, then Retry.`
    expect(gradeFix('path_not_allowed', 'repoPath must be the project repo (DOJO_PROJECT_REPO) or inside it', LOCAL)).toBe(rule)
    expect(gradeFix(undefined, 'repoPath must be the project repo (DOJO_PROJECT_REPO) or inside it', LOCAL)).toContain('Fix the Repo folder above')
    expect(gradeFix('path_not_allowed', 'no project repo is set', null)).toContain(PROJECT_REPO_UNSET)
    expect(gradeFix('bad_request', '/Users/me/x is not a folder on this Mac')).toContain('does not exist on this Mac')
    expect(gradeFix('bad_request', '/Users/me/x is not a git repository')).toContain('not a git repository')
    expect(gradeFix('claude_signed_out', 'x')).toBe('Claude Code is signed out. Sign in, then Retry.')
    expect(gradeFix('helper_unreachable', 'x')).toContain('Restart Dojo')
    expect(gradeFix('claude_failed', 'fake grade unavailable')).toBe('Nothing was saved. Retry; if it fails again, the line below says why.')
  })

  it('shows no view before a grade and the commit as not checked yet', async () => {
    const a = await get(await gradable(), 'art-stage-00')
    expect(gradeView(a)).toBeNull()
    expect(commitCheckText(a)).toBe('Commit not checked yet')
    expect(commitCheckText({ ...a, commit: undefined })).toBeNull()
    expect(commitCheckText({ ...a, commitFound: true })).toBe('Commit checked')
    expect(commitCheckText({ ...a, commitFound: false })).toBe('Commit not found')
  })
})

describe('requestGrade with the fake provider', () => {
  it('default: stores 4/5 passed on the artifact, one grades row and one grade event', async () => {
    const d = await gradable()
    const res = await requestGrade(d, 'art-stage-00', '', () => T0)
    expect(res.ok).toBe(true)
    const a = await get(d, 'art-stage-00')
    expect(a).toMatchObject({ grade: 4, gradedAt: T0, gradeMissing: [], commitFound: true })
    expect(a.gradeFeedback?.[0]).toMatch(/^\[fake:grade\] .*art-stage-00/)
    expect(gradeView(a)).toMatchObject({ score: '4/5', passed: true, verdict: 'Passed', at: '14 Oct 2026' })
    expect(await d.grades.toArray()).toMatchObject([
      { targetKind: 'artifact', targetId: 'art-stage-00', at: T0, score: 4, max: 5, passed: true, commitFound: true, provider: 'fake' },
    ])
    expect(await d.events.toArray()).toMatchObject([{ t: 'grade', id: 'art-stage-00', at: T0, score: 4, max: 5 }])
  })

  it('low: 2/5 Not yet with a missing item', async () => {
    localStorage.setItem('dojo:fake-ai-grade', 'low')
    const d = await gradable()
    expect((await requestGrade(d, 'art-stage-00', '', () => T0)).ok).toBe(true)
    const a = await get(d, 'art-stage-00')
    expect(gradeView(a)).toMatchObject({ score: '2/5', passed: false, verdict: 'Not yet' })
    expect(a.gradeMissing?.[0]).toMatch(/^\[fake:grade\]/)
  })

  it('error: nothing is saved and the earlier grade stays', async () => {
    const d = await gradable()
    await requestGrade(d, 'art-stage-00', '', () => T0)
    localStorage.setItem('dojo:fake-ai-grade', 'error')
    expect(await requestGrade(d, 'art-stage-00', 'x', () => T0 + 5)).toEqual({ ok: false, error: 'fake grade unavailable', code: 'claude_failed' })
    expect(await get(d, 'art-stage-00')).toMatchObject({ grade: 4, gradedAt: T0 })
    expect(await d.grades.count()).toBe(1)
    expect(await d.events.count()).toBe(1)
  })

  it('the fail hook also fails without writing', async () => {
    localStorage.setItem('dojo-ai-fake-fail', 'grade')
    const d = await gradable()
    const res = await requestGrade(d, 'art-stage-00', '', () => T0)
    expect(res.ok).toBe(false)
    expect(await d.grades.count()).toBe(0)
  })

  it('refuses without a repo and a valid commit, and makes no call', async () => {
    const d = await gradable({ repo: undefined })
    expect(await requestGrade(d, 'art-stage-00', '', () => T0)).toEqual({ ok: false, error: GRADE_DISABLED_REASON })
    expect(await d.grades.count()).toBe(0)
  })

  it('recordGrade stores a pasted commit summary and drops an unreported commitFound', async () => {
    const d = await gradable({ commitFound: true })
    await recordGrade(d, 'art-stage-00', { score: 3, max: 5, passed: true, feedback: ['ok'], missing: [] }, 'helper', T0, ' 2 files ')
    const a = await get(d, 'art-stage-00')
    expect(a.commitFound).toBeUndefined()
    expect(a.commitSummary).toBe('2 files')
    expect(await recordGrade(d, 'nope', { score: 3, max: 5, passed: true, feedback: [], missing: [] }, 'fake', T0)).toBe(false)
  })
})
