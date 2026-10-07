export type EngineName = 'charts' | 'pom-stage' | 'algo' | 'algo2' | 'diagram' | 'atlas-pieces'

const TAG: Partial<Record<EngineName, string>> = {
  charts: 'sr-chart', 'pom-stage': 'pom-stage', algo: 'sr-algo', algo2: 'sr-algo2', diagram: 'sr-diagram',
}

type Win = Window & { SRAtlas?: unknown }

/** True once the engine's script has run: its custom element is defined, or (atlas-pieces) its global exists. */
function isReady(name: EngineName): boolean {
  if (name === 'atlas-pieces') return !!(window as Win).SRAtlas
  return !!customElements.get(TAG[name] as string)
}

const pending = new Map<EngineName, Promise<void>>()

/** Lazily adds /engines/<name>.js once. Rejects on a load error and forgets it, so a later mount retries. */
export function loadEngine(name: EngineName): Promise<void> {
  if (typeof customElements !== 'undefined' && isReady(name)) return Promise.resolve()
  const existing = pending.get(name)
  if (existing) return existing
  const p = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = `/engines/${name}.js`
    s.async = true
    s.dataset.engine = name
    s.addEventListener('load', () => resolve())
    s.addEventListener('error', () => {
      pending.delete(name)
      reject(new Error(`engine ${name} failed to load`))
    })
    document.head.appendChild(s)
  })
  pending.set(name, p)
  return p
}

/** The three scripts every algorithm picture needs (VISUALIZER "four places, one engine"). */
export function loadAlgoEngines(): Promise<void> {
  return Promise.all([loadEngine('algo'), loadEngine('algo2'), loadEngine('atlas-pieces')]).then(() => undefined)
}

export function resetEnginesForTest(): void {
  pending.clear()
}
