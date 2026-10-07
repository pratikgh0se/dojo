// The only file the Node helper takes from the app. scripts/build-helper-shared.mjs bundles it into
// server/gen/ai-shared.mjs. If a foundation export is renamed, fix it here and run `npm run helper:gen`.
import { fakeOutput as appFakeOutput } from '../src/ai/fake'
import { systemPrompt as appSystemPrompt } from '../src/ai/guardrails'
import { jobPrompt as appJobPrompt } from '../src/ai/prompts'
import type { JobName } from '../src/ai/types'
import { repairOutput as appRepairOutput } from '../src/ai/repair'
import { validateOutput } from '../src/ai/validate'

type Req = { ticket: unknown; context: unknown }

export function fakeOutput(job: JobName, req: Req): unknown {
  return appFakeOutput(job, req as Parameters<typeof appFakeOutput>[1])
}

export function checkOutput(job: JobName, output: unknown): string | null {
  const errors = validateOutput(job, output)
  return errors.length ? errors.join('; ') : null
}

export function repairOutput(job: JobName, req: Req, output: unknown): unknown {
  return appRepairOutput(job, req, output)
}

export function systemPrompt(job: JobName): string {
  return appSystemPrompt(job)
}

export function jobPrompt(job: JobName, req: Req, evidence = ''): string {
  return appJobPrompt(job, req, evidence)
}
