type Env = Record<string, string | undefined>
export const SMOKE_REQUEST: { ticket: { id: string; title: string; track: string; text: string; pattern: string }; context: { level: number } }
export function smoke(env?: Env, log?: (s: string) => void): Promise<0 | 1 | 2>
