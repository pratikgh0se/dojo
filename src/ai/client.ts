// The one way the app calls a model job (spec §4.3). Never throws: every failure resolves to
// {ok:false, code, error} so the panel can show the raw error and a Retry (AI.md "UI contract").
import { now } from '../lib/clock'
import { fakeOutput, readFakeHooks } from './fake'
import {
  AiJobError, isAiErrorCode,
  type AiErrorCode, type JobName, type JobOutput, type JobRequest, type JobResult, type ProviderName,
} from './types'
import { repairOutput } from './repair'
import { validateOutput } from './validate'
import { READ_ONLY_MESSAGE, writerHeaders } from '../data/writer'

export const DEFAULT_HELPER_PORT = 8788

export interface AiConfig { provider: ProviderName; helperUrl: string }

export function aiConfig(env: Record<string, unknown> = import.meta.env): AiConfig {
  const provider: ProviderName = env.VITE_DOJO_AI === 'helper' ? 'helper' : 'fake'
  const url = typeof env.VITE_DOJO_HELPER_URL === 'string' ? env.VITE_DOJO_HELPER_URL.trim().replace(/\/+$/, '') : ''
  const rawPort = typeof env.VITE_DOJO_AI_PORT === 'string' ? env.VITE_DOJO_AI_PORT.trim() : ''
  const port = /^\d+$/.test(rawPort) ? Number(rawPort) : DEFAULT_HELPER_PORT
  // C-DESKTOP: the Mac app's build passes VITE_DOJO_HELPER_URL=self: the helper routes are on the app's own server
  if (url === 'self') return { provider, helperUrl: '' }
  // `same-origin` (from main's installer fix): the same idea, resolved to an absolute origin.
  if (url === 'same-origin') return { provider, helperUrl: window.location.origin }
  return { provider, helperUrl: url || `http://127.0.0.1:${port}` }
}

export interface RunOptions {
  config?: AiConfig
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  /** fake hooks source; undefined = window.localStorage, null = none */
  storage?: Pick<Storage, 'getItem'> | null
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

async function runFake<J extends JobName>(job: J, req: JobRequest<J>, opts: RunOptions): Promise<JobOutput<J>> {
  const hooks = readFakeHooks(job, opts.storage, req.ticket?.id)
  if (hooks.delayMs > 0) await sleep(hooks.delayMs)
  if (hooks.fail) throw new AiJobError(hooks.fail, `fake ${job} unavailable`)
  return fakeOutput(job, req, hooks.variant)
}

async function runHelper<J extends JobName>(job: J, req: JobRequest<J>, config: AiConfig, opts: RunOptions): Promise<JobOutput<J>> {
  const f: typeof fetch = opts.fetchImpl ?? ((input, init) => globalThis.fetch(input, init))
  let res: Response
  try {
    res = await f(`${config.helperUrl}/ai/${job}`, {
      method: 'POST',
      // SEC-D-06: the app's server runs a job for the writer only
      headers: { 'Content-Type': 'application/json', ...writerHeaders() },
      body: JSON.stringify({ ticket: req.ticket, context: req.context }),
      signal: opts.signal,
    })
  } catch (e) {
    throw new AiJobError('helper_unreachable', `helper unreachable at ${config.helperUrl}: ${e instanceof Error ? e.message : String(e)}`)
  }
  const text = await res.text()
  let body: unknown = null
  try {
    body = JSON.parse(text)
  } catch {
    body = null
  }
  if (isObj(body) && body.ok === true && 'output' in body) return body.output as JobOutput<J>
  if (res.status === 403 && isObj(body) && isObj(body.error) && body.error.code === 'not_writer') throw new AiJobError('bad_request', READ_ONLY_MESSAGE)
  if (isObj(body) && isObj(body.error) && isAiErrorCode(body.error.code)) {
    const code: AiErrorCode = body.error.code
    throw new AiJobError(code, typeof body.error.message === 'string' ? body.error.message : code)
  }
  throw new AiJobError('claude_failed', `HTTP ${res.status}: ${text.slice(0, 200)}`)
}

export async function runJob<J extends JobName>(job: J, req: JobRequest<J>, opts: RunOptions = {}): Promise<JobResult<J>> {
  const config = opts.config ?? aiConfig()
  const started = now()
  const ms = () => Math.max(0, now() - started)
  const fail = (code: AiErrorCode, error: string): JobResult<J> => ({ ok: false, job, provider: config.provider, ms: ms(), code, error })
  try {
    const raw = config.provider === 'fake' ? await runFake(job, req, opts) : await runHelper(job, req, config, opts)
    const output = repairOutput(job, req, raw) as JobOutput<J>
    const errors = validateOutput(job, output)
    if (errors.length > 0) return fail('invalid_output', `invalid ${job} output: ${errors.join('; ')}`)
    return { ok: true, job, provider: config.provider, ms: ms(), output }
  } catch (e) {
    if (e instanceof AiJobError) return fail(e.code, e.message)
    return fail('claude_failed', e instanceof Error ? e.message : String(e))
  }
}
