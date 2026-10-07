export function fakeOutput(job: string, req: { ticket: unknown; context: unknown }): unknown
export function checkOutput(job: string, output: unknown): string | null
export function systemPrompt(job: string): string
export function jobPrompt(job: string, req: { ticket: unknown; context: unknown }, evidence?: string): string
