// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ALLOWED_PERMISSIONS, isLocalHost, linkVerdict, permissionAllowed } from '../../electron/links.mjs'

describe('SEC-D-05: which links leave the window', () => {
  it.each([
    'https://example.com/x', 'http://example.com/plain', 'https://go.dev/doc/', 'https://8.8.8.8/', 'http://[2606:4700::1111]/',
  ])('%s opens in the default browser', u => expect(linkVerdict(u)).toBe('open'))

  it.each([
    'http://127.0.0.1:8787/db/state', 'https://127.0.0.1/', 'http://localhost:3000/', 'http://app.localhost/', 'http://[::1]:9/',
    'http://192.168.1.1/', 'http://10.0.0.2/admin', 'http://172.20.1.1/', 'http://169.254.169.254/latest', 'http://100.64.0.1/',
    'http://0.0.0.0:80/', 'http://0x7f000001/', 'http://2130706433/', 'http://[::ffff:192.168.0.1]/', 'http://[fd00::1]/', 'http://[fe80::1]/',
    'http://router/', 'http://nas.local/', 'https://printer.lan/', 'http://host.home.arpa/', 'http://LOCALHOST./',
  ])('%s asks first (this Mac or the local network)', u => expect(linkVerdict(u)).toBe('confirm'))

  it.each([
    'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,<b>x</b>', 'vscode://file/x', 'smb://nas/share', 'x-apple.systempreferences:',
    'https://user:pw@example.com/', 'not a url', '',
  ])('%s never opens', u => expect(linkVerdict(u)).toBe('refuse'))

  it('isLocalHost: a dotted public name is not local', () => {
    expect(isLocalHost('example.com')).toBe(false)
    expect(isLocalHost('localhost')).toBe(true)
  })

  it('main.mjs routes both the window-open and the navigate handlers through the verdict, never a bare openExternal', () => {
    const main = readFileSync('electron/main.mjs', 'utf8')
    expect(main.match(/shell\.openExternal\(/g)).toHaveLength(2) // openOutside's two calls (open, and open after confirming)
    expect(main).toMatch(/setWindowOpenHandler\(\(\{ url: u \}\) => \{ if \(!own\(u\)\) openOutside\(u\)/)
    expect(main).toMatch(/will-navigate', \(e, u\) => \{ if \(!own\(u\)\) \{ e\.preventDefault\(\); openOutside\(u\)/)
  })
})

describe('SEC-D-04: the window gets no browser permission', () => {
  const app = 'http://127.0.0.1:52000'
  it.each(['media', 'geolocation', 'notifications', 'clipboard-read', 'clipboard-sanitized-write', 'display-capture', 'fullscreen', 'midi', 'openExternal', 'unknown'])(
    '%s is denied, even for the app itself', p => {
      expect(permissionAllowed(p, `${app}/`, app)).toBe(false)
    },
  )
  it('the allow-list is empty, and an allowed one would still need the app origin', () => {
    expect([...ALLOWED_PERMISSIONS]).toEqual([])
    ALLOWED_PERMISSIONS.add('fullscreen')
    try {
      expect(permissionAllowed('fullscreen', `${app}/board`, app)).toBe(true)
      expect(permissionAllowed('fullscreen', 'https://evil.example/', app)).toBe(false)
      expect(permissionAllowed('fullscreen', 'null', app)).toBe(false)
    } finally { ALLOWED_PERMISSIONS.delete('fullscreen') }
  })
  it('main.mjs installs both handlers before the window loads', () => {
    const main = readFileSync('electron/main.mjs', 'utf8')
    expect(main).toContain('setPermissionRequestHandler')
    expect(main).toContain('setPermissionCheckHandler')
    expect(main.indexOf('lockPermissions(target.url)')).toBeLessThan(main.indexOf('createWindow(target)'))
  })
})
