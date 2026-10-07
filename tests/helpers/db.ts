import { createDb, patchSettings, type DojoDB } from '../../src/data/db'
import { runReconcile } from '../../src/data/seed'
import type { PlanJson } from '../../src/data/types'
import { smallPlan } from './plan'

export function freshDb(): DojoDB {
  return createDb(`test-${Math.random().toString(36).slice(2)}`)
}

export async function seededDb(plan: PlanJson = smallPlan, startDate = '2026-09-07'): Promise<DojoDB> {
  const d = freshDb()
  await runReconcile(d, plan)
  await patchSettings(d, { startDate })
  return d
}

export function failingDb(table: string): DojoDB {
  const d = freshDb()
  d.use({
    stack: 'dbcore',
    name: `fail-${table}`,
    create: down => ({
      ...down,
      table(name: string) {
        const t = down.table(name)
        return name === table ? { ...t, mutate: () => Promise.reject(new Error('boom')) } : t
      },
    }),
  })
  return d
}
