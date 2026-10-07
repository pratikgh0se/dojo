let provider: () => number = () => Date.now()

export function now(): number {
  return provider()
}

export function setNow(fn: () => number): void {
  provider = fn
}

export function resetNow(): void {
  provider = () => Date.now()
}
