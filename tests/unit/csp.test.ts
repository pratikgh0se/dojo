// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { appCsp, CSP_REPORT_PATH, cspReportFile } from '../../server/csp.mjs'

const directives = (csp: string) => new Map(csp.split(';').map(d => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]))

describe('SEC-D-03: appCsp', () => {
  it('the shipped policy: no inline script, no eval, own origin only, nothing may frame the app', () => {
    const d = directives(appCsp())
    expect(d.get('default-src')).toEqual(["'self'"])
    expect(d.get('script-src')).toEqual(["'self'"])
    expect(d.get('connect-src')).toEqual(["'self'"])
    expect(d.get('font-src')).toEqual(["'self'"])
    expect(d.get('frame-src')).toEqual(["'self'"])
    expect(d.get('worker-src')).toEqual(["'self'"])
    expect(d.get('img-src')).toEqual(["'self'", 'data:', 'blob:'])
    expect(d.get('style-src')).toEqual(["'self'", "'unsafe-inline'"]) // the engines' shadow-root <style> and style=""
    expect(d.get('object-src')).toEqual(["'none'"])
    expect(d.get('base-uri')).toEqual(["'none'"])
    expect(d.get('form-action')).toEqual(["'none'"])
    expect(d.get('frame-ancestors')).toEqual(["'none'"])
    expect(appCsp()).not.toMatch(/unsafe-eval|wasm-unsafe-eval|report-uri|\*/)
  })

  it('dev adds only the inline preamble, HMR and the loopback helper, and only to script-src and connect-src', () => {
    const prod = directives(appCsp())
    const dev = directives(appCsp({ dev: true }))
    expect(dev.get('script-src')).toEqual(["'self'", "'unsafe-inline'"])
    expect(dev.get('connect-src')).toEqual(["'self'", 'ws://127.0.0.1:*', 'ws://localhost:*', 'http://127.0.0.1:*', 'http://localhost:*'])
    for (const [k, v] of prod) if (k !== 'script-src' && k !== 'connect-src') expect(dev.get(k), k).toEqual(v)
  })

  it('report appends the e2e sink', () => {
    expect(appCsp({ report: true })).toBe(`${appCsp()}; report-uri ${CSP_REPORT_PATH}`)
  })

  it('cspReportFile takes an absolute DOJO_CSP_REPORT_FILE only', () => {
    expect(cspReportFile({})).toBeNull()
    expect(cspReportFile({ DOJO_CSP_REPORT_FILE: '' })).toBeNull()
    expect(cspReportFile({ DOJO_CSP_REPORT_FILE: 'rel/csp.jsonl' })).toBeNull()
    expect(cspReportFile({ DOJO_CSP_REPORT_FILE: '/tmp/x/csp.jsonl' })).toBe('/tmp/x/csp.jsonl')
  })
})
