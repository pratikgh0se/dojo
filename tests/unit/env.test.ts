import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('test environment', () => {
  it('runs in Asia/Kolkata (UTC+05:30, no DST)', () => {
    expect(new Date(2026, 8, 7).getTimezoneOffset()).toBe(-330)
    expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(-330)
  })

  it('has an IndexedDB implementation (fake-indexeddb)', () => {
    expect(typeof indexedDB.open).toBe('function')
  })

  it('ships plan.json in public/data', () => {
    const plan = JSON.parse(readFileSync('public/data/plan.json', 'utf8'))
    expect(plan.sprints).toHaveLength(72)
  })
})
