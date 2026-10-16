import { describe, expect, it } from 'vitest'
import { linkVerdict } from '../../src/screens/brief/linkVerdict'

describe('linkVerdict (UAT cu-4 P3-4)', () => {
  it('ok is ok; a host that refuses the check is unverified; the rest that failed is broken', () => {
    expect(linkVerdict({ ok: true, status: 200 })).toBe('ok')
    expect(linkVerdict({ ok: true, status: 301 })).toBe('ok')
    for (const status of [401, 403, 429, 999]) expect(linkVerdict({ ok: false, status })).toBe('unverified')
    for (const status of [0, 400, 404, 410, 500, 503]) expect(linkVerdict({ ok: false, status })).toBe('broken')
  })
})
