// The GitHub CLI, run by name from PATH or from DOJO_GH_BIN (the Portfolio fixtures point it at a stub; tests never reach a real gh).
import { PortfolioError, run, tail } from './util.mjs'

export const GH_SIGNED_OUT = 'GitHub CLI is not signed in. Run gh auth login in a terminal, then try again.'

/** deps = { env, ghBin }. The environment is passed whole, so HOME (the stub's state, git's identity) and PATH survive. */
export const gh = (deps, args, opts = {}) => run(deps.ghBin, args, { env: deps.env, timeoutMs: 120_000, ...opts })

/** The signed-in GitHub login. Two read-only calls: `gh auth status`, then `gh api user --jq .login`. Throws gh_missing, gh_not_logged_in or gh_failed. */
export async function ghLogin(deps) {
  const a = await gh(deps, ['auth', 'status'], { timeoutMs: 30_000 })
  if (a.error?.code === 'ENOENT') throw new PortfolioError('gh_missing', 'The GitHub CLI (gh) was not found. Install it from https://cli.github.com, then try again.')
  if (a.status === null) throw new PortfolioError('gh_failed', `The GitHub CLI did not answer: ${a.error?.message ?? 'no reply'}`)
  if (a.status !== 0) throw new PortfolioError('gh_not_logged_in', GH_SIGNED_OUT)
  const u = await gh(deps, ['api', 'user', '--jq', '.login'], { timeoutMs: 30_000 })
  const login = u.status === 0 ? String(u.stdout).trim() : ''
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(login)) throw new PortfolioError('gh_failed', `Could not read your GitHub user name: ${tail(u.stderr)}`)
  return login
}
