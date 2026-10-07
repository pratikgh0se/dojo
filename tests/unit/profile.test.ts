// @vitest-environment node
// G6: DOJO_HOME/profile.json keeps one learner's own values out of the shipped app (server/profile.mjs).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { overlayPlan, PLAN_OVERLAY_KEYS, readProfile, resolveProjectRepo } from '../../server/profile.mjs'

let home = ''
afterEach(() => { if (home) rmSync(home, { recursive: true, force: true }) })

describe('profile.json', () => {
  it('reads an object, and {} for a missing, broken or non-object file', () => {
    home = mkdtempSync(join(tmpdir(), 'dojo-profile-'))
    expect(readProfile(home)).toEqual({})
    expect(readProfile(undefined)).toEqual({})
    for (const bad of ['{ nope', '[1]', '"x"', 'null']) {
      writeFileSync(join(home, 'profile.json'), bad)
      expect(readProfile(home), bad).toEqual({})
    }
    writeFileSync(join(home, 'profile.json'), '{"projectRepo":"~/p"}')
    expect(readProfile(home)).toEqual({ projectRepo: '~/p' })
  })

  it('project repo: unset by default; DOJO_PROJECT_REPO first, then the profile; ~ expands; relative paths are refused', () => {
    expect(resolveProjectRepo({}, {}, '/Users/l')).toBeNull()
    expect(resolveProjectRepo({ DOJO_PROJECT_REPO: '  ' }, {}, '/Users/l')).toBeNull()
    expect(resolveProjectRepo({}, { projectRepo: '~/code/forge' }, '/Users/l')).toBe('/Users/l/code/forge')
    expect(resolveProjectRepo({ DOJO_PROJECT_REPO: '/srv/x/' }, { projectRepo: '~/code/forge' }, '/Users/l')).toBe('/srv/x')
    expect(resolveProjectRepo({}, { projectRepo: 'code/forge' }, '/Users/l')).toBeNull()
    expect(resolveProjectRepo({}, { projectRepo: 42 }, '/Users/l')).toBeNull()
  })

  it('overlays only the schedule and learner keys, and returns the text untouched without them', () => {
    expect(PLAN_OVERLAY_KEYS).toEqual(['schedule', 'learner'])
    const text = '{"rotation":{"Mon":"AI watch"},"schedule":{"restDay":"x"}}'
    expect(overlayPlan(text, {})).toBe(text)
    expect(overlayPlan(text, { plan: [] })).toBe(text)
    expect(overlayPlan(text, { plan: { rotation: { Mon: 'no' } } })).toBe(text)
    expect(JSON.parse(overlayPlan(text, { plan: { schedule: { restDay: 'mine' }, learner: { patternsRepo: 'https://e.x' } } }))).toEqual({
      rotation: { Mon: 'AI watch' }, schedule: { restDay: 'mine' }, learner: { patternsRepo: 'https://e.x' },
    })
  })
})
