// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { fakeOutput as appFakeOutput } from '../../src/ai/fake'

const HINT_REQ = { ticket: { id: 'p200', title: 'Number of Islands', track: 'dsa' }, context: { level: 1 } }

describe('helper shared bundle', () => {
  it('is up to date with src/ai (run npm run helper:gen after foundation AI changes)', () => {
    expect(() => execFileSync('node', ['scripts/build-helper-shared.mjs', '--check'], { cwd: process.cwd(), stdio: 'pipe' })).not.toThrow()
  })

  it('returns exactly the app fake outputs', async () => {
    const shared = await import('../../server/gen/ai-shared.mjs')
    expect(shared.fakeOutput('hint', HINT_REQ)).toEqual(appFakeOutput('hint', HINT_REQ as never))
    const slide = { ticket: null, context: { tickets: [{ id: 'a', title: 'A', track: 'ai', estMin: 50, slidCount: 0 }], count: 1 } }
    expect(shared.fakeOutput('suggest_slide', slide)).toEqual(appFakeOutput('suggest_slide', slide as never))
  })

  it('checks outputs with the app validator and exposes the guardrail system text', async () => {
    const shared = await import('../../server/gen/ai-shared.mjs')
    expect(shared.checkOutput('hint', shared.fakeOutput('hint', HINT_REQ))).toBeNull()
    expect(shared.checkOutput('hint', { nope: 1 })).toEqual(expect.any(String))
    expect(shared.systemPrompt('hint')).toMatch(/Never output a complete solution/)
  })

  it('exposes the app prompt builder', async () => {
    const shared = await import('../../server/gen/ai-shared.mjs')
    expect(shared.jobPrompt('hint', HINT_REQ)).toContain('OUTPUT SCHEMA (hint)')
  })

  it('SEC-D-01: the helper copy rejects markup and over-long title/complexity in a picture, like the app copy', async () => {
    const shared = await import('../../server/gen/ai-shared.mjs')
    const req = { ticket: { id: 'p200', title: 'Number of Islands', track: 'dsa' }, context: {} }
    const ok = shared.fakeOutput('picture', req) as Record<string, unknown>
    expect(shared.checkOutput('picture', ok)).toBeNull()
    expect(shared.checkOutput('picture', { ...ok, complexity: 'O(n)<img src=x onerror=alert(1)>' })).toBe('complexity contains < or >')
    expect(shared.checkOutput('picture', { ...ok, title: 'x'.repeat(121) })).toBe('title is 121 characters (max 120)')
    expect(shared.checkOutput('picture', { ...ok, code: ['while lo < hi', 'return lo'] })).toBeNull()
    expect(shared.jobPrompt('picture', req)).toContain('title is at most 120 characters and complexity at most 40')
  })
})
