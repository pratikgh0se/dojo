// The learner's local profile: DOJO_HOME/profile.json, never committed (G6 de-personalisation).
// It keeps one person's own values out of the shipped app while their install behaves as before:
//
//   {
//     "projectRepo": "~/projects/my-capstone",      // the local repo the grader may read (DOJO_PROJECT_REPO wins)
//     "plan": { "schedule": { ... }, "learner": { "patternsRepo": "https://github.com/..." } }
//   }
//
// `plan` is laid over /data/plan.json key by key (top level only) when dojo-server serves it, so the shipped
// sample plan carries neutral values and a profile restores the learner's own. Node standard library only.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

export const PROFILE_FILE = 'profile.json'
/** The plan keys a profile may replace: content the shipped plan.json must not carry for one person. */
export const PLAN_OVERLAY_KEYS = ['schedule', 'learner']

/** DOJO_HOME/profile.json as an object; {} when it is missing, unreadable, not JSON or not an object. */
export function readProfile(home) {
  if (!home) return {}
  try {
    const j = JSON.parse(readFileSync(join(home, PROFILE_FILE), 'utf8'))
    return j && typeof j === 'object' && !Array.isArray(j) ? j : {}
  } catch {
    return {}
  }
}

/** `~` and `~/x` against `home`; anything else unchanged. */
export function expandHome(p, home = homedir()) {
  return p === '~' ? home : p.startsWith('~/') ? join(home, p.slice(2)) : p
}

/**
 * The local project repo the grader may read: DOJO_PROJECT_REPO, else the profile's `projectRepo`; an absolute
 * path (after `~`), or null when neither is set or the value is not an absolute path. Unset by default.
 */
export function resolveProjectRepo(env = process.env, profile = {}, home = env.HOME || homedir()) {
  for (const raw of [env.DOJO_PROJECT_REPO, profile.projectRepo]) {
    if (typeof raw !== 'string' || raw.trim() === '') continue
    const p = expandHome(raw.trim(), home)
    return isAbsolute(p) ? resolve(p) : null
  }
  return null
}

/** plan.json text with the profile's `plan` keys (PLAN_OVERLAY_KEYS only) laid over it; the text unchanged without any. */
export function overlayPlan(planText, profile) {
  const over = profile?.plan
  if (!over || typeof over !== 'object' || Array.isArray(over)) return planText
  const keys = PLAN_OVERLAY_KEYS.filter(k => over[k] !== undefined)
  if (keys.length === 0) return planText
  const plan = JSON.parse(planText)
  for (const k of keys) plan[k] = over[k]
  return JSON.stringify(plan)
}
