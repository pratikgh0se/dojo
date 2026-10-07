export const LOG_ROTATE_BYTES: number
export function createLogger(home: string, maxBytes?: number): { file: string; log(line: string): void }
