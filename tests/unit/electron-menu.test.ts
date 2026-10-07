import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
// @ts-expect-error plain .mjs without types
import { buildMenuTemplate, revealWindow } from '../../electron/menu.mjs'

// Ruling 23 K4 (UAT cu-1 P3-4, P3-5, P3-12, P3-13): the native menu and the Dock click, tested without Electron.
const here = dirname(fileURLToPath(import.meta.url))
type Item = { role?: string; label?: string; accelerator?: string; type?: string; click?: () => void; submenu?: Item[] }
const make = (o: Record<string, unknown> = {}): Item[] =>
  buildMenuTemplate({ home: '/h', logs: '/h/logs', openPath: () => {}, openSettings: () => {}, ...o })
const menu = (t: Item[], label: string) => t.find(m => m.label === label || m.role === label)
const flat = (t: Item[]): Item[] => t.flatMap(m => [m, ...(m.submenu ? flat(m.submenu) : [])])

describe('the native menu bar', () => {
  it('has Dojo, File, Edit, View, Window and Help, in that order', () => {
    expect(make().map(m => m.label ?? m.role)).toEqual(['Dojo', 'File', 'editMenu', 'View', 'windowMenu', 'help'])
  })

  it('Dojo › Settings… is ⌘, and opens the Settings screen', () => {
    const openSettings = vi.fn()
    const app = menu(make({ openSettings }), 'Dojo')!
    const item = app.submenu!.find(i => i.label === 'Settings…')!
    expect(item.accelerator).toBe('CmdOrCtrl+,')
    item.click!()
    expect(openSettings).toHaveBeenCalledTimes(1)
    // it sits between About and Services, like every Mac app, and the standard items stay
    expect(app.submenu!.map(i => i.role ?? i.label ?? i.type)).toEqual(
      ['about', 'separator', 'Settings…', 'separator', 'services', 'separator', 'hide', 'hideOthers', 'unhide', 'separator', 'quit'])
  })

  it('File › Close Window closes the window (⌘W by the role)', () => {
    const file = menu(make(), 'File')!
    expect(file.submenu).toEqual([{ role: 'close', label: 'Close Window' }])
  })

  // UAT cu-1 P3-13 / cu-3p P3-4 / cu-4 P3-12 / cu-8 P3-1 (ruling 23 K4): Toggle Full Screen appears once, counting what Electron
  // makes of the roles (editMenu, windowMenu, help) as well as what the template says. The role `togglefullscreen` is a click
  // handler, so AppKit did not see it as its own `toggleFullScreen:` action and added a second item; on macOS ours is that action.
  // What Electron's menu-item-roles define for the roles the bar uses (none of them carries a full-screen item):
  const ROLE_ITEMS: Record<string, Item[]> = {
    editMenu: ['undo', 'redo', 'separator', 'cut', 'copy', 'paste', 'pasteAndMatchStyle', 'delete', 'selectAll', 'separator', 'speechSubmenu'].map(r => (r === 'separator' ? { type: r } : { role: r })),
    windowMenu: ['minimize', 'zoom', 'separator', 'front', 'separator', 'window'].map(r => (r === 'separator' ? { type: r } : { role: r })),
    help: [],
  }
  const expand = (t: Item[]): Item[] => t.flatMap(m => [m, ...(m.submenu ? expand(m.submenu) : m.role && ROLE_ITEMS[m.role] ? ROLE_ITEMS[m.role] : [])])
  const isFullScreen = (i: Item & { selector?: string }) => i.role === 'togglefullscreen' || i.role === 'viewMenu' || i.selector === 'toggleFullScreen:' || /full\s*screen/i.test(i.label ?? '')

  it.each(['darwin', 'linux', 'win32'])('%s: the whole menu bar, roles expanded, has exactly one full-screen item, in View', platform => {
    for (const isDev of [false, true]) {
      const t = make({ platform, isDev })
      expect(expand(t).filter(isFullScreen)).toHaveLength(1)
      expect(menu(t, 'View')!.submenu!.filter(isFullScreen)).toHaveLength(1)
      expect(t.some(m => m.role === 'viewMenu')).toBe(false) // viewMenu expands to its own togglefullscreen
    }
  })

  it('on macOS the one item is the native toggleFullScreen: action with its shortcut, so AppKit adds no second', () => {
    const item = menu(make({ platform: 'darwin' }), 'View')!.submenu!.find(isFullScreen) as Item & { selector?: string }
    expect(item).toMatchObject({ label: 'Toggle Full Screen', accelerator: 'Ctrl+Command+F', selector: 'toggleFullScreen:' })
    expect(item.role).toBeUndefined()
    expect(menu(make({ platform: 'linux' }), 'View')!.submenu!.find(isFullScreen)).toEqual({ role: 'togglefullscreen' })
    expect(menu(make({ platform: 'darwin' }), 'View')!.submenu!.map(i => i.role ?? i.type ?? i.label)).toEqual(['resetZoom', 'zoomIn', 'zoomOut', 'separator', 'Toggle Full Screen'])
  })

  it('macOS is told not to add its own full-screen item: the launch default is set before the menu is built', () => {
    const main = readFileSync(join(here, '..', '..', 'electron', 'main.mjs'), 'utf8')
    const at = main.indexOf("setUserDefault('NSFullScreenMenuItemEverywhere', 'boolean', false)")
    expect(at).toBeGreaterThan(-1)
    expect(at).toBeLessThan(main.indexOf('Menu.setApplicationMenu')) // before the menu exists
    expect(at).toBeLessThan(main.indexOf('app.whenReady')) // and before the app is ready
  })

  it('Reload and DevTools exist only in a dev build', () => {
    const roles = (isDev: boolean) => menu(make({ isDev }), 'View')!.submenu!.map(i => i.role)
    expect(roles(false)).not.toContain('reload')
    expect(roles(true)).toEqual(expect.arrayContaining(['reload', 'toggleDevTools']))
  })

  it('Help opens the data and logs folders', () => {
    const openPath = vi.fn()
    const help = menu(make({ openPath, home: '/Users/p/Dojo', logs: '/Users/p/Dojo/logs' }), 'help')!
    help.submenu!.forEach(i => i.click!())
    expect(help.submenu!.map(i => i.label)).toEqual(['Open Data Folder', 'Open Logs Folder'])
    expect(openPath.mock.calls).toEqual([['/Users/p/Dojo'], ['/Users/p/Dojo/logs']])
  })
})

describe('a Dock click (activate) and a second launch bring the window back', () => {
  const fake = (minimized: boolean) => {
    const calls: string[] = []
    return {
      calls,
      isMinimized: () => minimized,
      restore: () => calls.push('restore'),
      show: () => calls.push('show'),
      focus: () => calls.push('focus'),
    }
  }

  it('restores a minimised window, then shows and focuses it', () => {
    const w = fake(true)
    expect(revealWindow(w)).toBe(true)
    expect(w.calls).toEqual(['restore', 'show', 'focus'])
  })

  it('only shows and focuses one that is not minimised', () => {
    const w = fake(false)
    revealWindow(w)
    expect(w.calls).toEqual(['show', 'focus'])
  })

  it('does nothing without a window, or with a destroyed one', () => {
    expect(revealWindow(null)).toBe(false)
    expect(revealWindow(undefined)).toBe(false)
    const w = { ...fake(true), isDestroyed: () => true }
    expect(revealWindow(w)).toBe(false)
    expect(w.calls).toEqual([])
  })
})
