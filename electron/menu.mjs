// The native menu bar (C-DESKTOP DK1, ruling 23 K4), kept apart from main.mjs so it can be unit tested without Electron.
//
//  - Dojo › Settings… (⌘,) opens the Settings screen; File › Close Window (⌘W) closes the window (DK1: closing the
//    only window quits the app);
//  - View carries ONE Toggle Full Screen (ruling 23 K4: "appears once"). macOS adds an "Enter Full Screen" item of its own to a
//    menu called View, which beside ours listed two (UAT cu-1 P3-13, cu-3p P3-4); so the app also switches that one off
//    (NSFullScreenMenuItemEverywhere = NO: main.mjs at launch, the Info.plist, and the installer's `defaults write`), because
//    AppKit reads that default when the app starts. Dropping ours instead left View with none once the default was in place
//    (UAT cu-4 resume run on 45f8e44), so ours stays and macOS's goes.
//
//  - Why two items kept coming back (UAT cu-8 P3-1, after 73f3d6f): `role: 'togglefullscreen'` is a role Electron implements as
//    a click handler (window.setFullScreen), not as the native `toggleFullScreen:` action. AppKit only skips its own item when
//    the View menu already holds an item with that ACTION, so it saw none and added its own beside ours, whatever the
//    NSFullScreenMenuItemEverywhere default said on a given machine or launch. On macOS ours is therefore the native action
//    (`selector: 'toggleFullScreen:'`): AppKit finds it, and adds nothing. The default stays as a second line of defence.
//    The other roles the bar expands (editMenu, windowMenu, help) carry no full-screen item.
//
// `openSettings` and `openPath` are the app's: the template only names them.

/** The one Toggle Full Screen: the native action on macOS (so AppKit adds no second), Electron's role elsewhere. */
export function fullScreenItem(platform = process.platform) {
  return platform === 'darwin'
    ? { label: 'Toggle Full Screen', accelerator: 'Ctrl+Command+F', selector: 'toggleFullScreen:' }
    : { role: 'togglefullscreen' }
}

/** @param {{ appName?: string, isDev?: boolean, platform?: string, home: string, logs: string, openPath: (p: string) => unknown, openSettings: () => unknown }} o */
export function buildMenuTemplate({ appName = 'Dojo', isDev = false, platform = process.platform, home, logs, openPath, openSettings }) {
  return [
    {
      label: appName,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => openSettings() },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { label: 'File', submenu: [{ role: 'close', label: 'Close Window' }] },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        ...(isDev ? [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }] : []),
        { role: 'resetZoom', label: 'Actual Size' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        fullScreenItem(platform),
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Open Data Folder', click: () => openPath(home) },
        { label: 'Open Logs Folder', click: () => openPath(logs) },
      ],
    },
  ]
}

/**
 * Brings the app's window forward: out of the Dock if minimised, then shown and focused. A Dock click (the `activate`
 * event) and a second launch both do this (DK1/DK2); macOS itself leaves a minimised window where it is.
 * @param {{ isDestroyed?: () => boolean, isMinimized: () => boolean, restore: () => void, show: () => void, focus: () => void } | null | undefined} win
 * @returns {boolean} whether there was a window to bring forward
 */
export function revealWindow(win) {
  if (!win || win.isDestroyed?.()) return false
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  return true
}
