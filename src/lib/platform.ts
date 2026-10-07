// The Mac app (C-DESKTOP) and a browser run the same web build. The blind suites keep testing it in a browser against
// the contracts' copy, unchanged; inside the app, copy that talks about the browser, the Dock launcher, `npm run …`
// or reloading a page is wrong, so those few texts have a Mac version (as Fretboard's src/platform.ts).

/** True inside the Dojo app window: Electron's user agent carries "Electron/<version>". */
export const isDesktopApp = (ua: string = typeof navigator === 'undefined' ? '' : navigator.userAgent ?? ''): boolean => /\bElectron\//.test(ua)

/** Decided once at load (the window never changes platform). */
export const DESKTOP = isDesktopApp()

export interface Copy { web: string; desktop: string }

/** Texts with a Mac version. `web` is the contract's text, kept byte for byte for the browser build. */
export const COPY = {
  saveHelp: {
    web: 'Dojo is not connected to its disk server. Open Dojo from the Dock, or run npm run dev.',
    desktop: 'Dojo is not connected to its disk server. Quit Dojo and open it again.',
  },
  backupsDown: {
    web: 'Backups need the Dojo server. Open Dojo from the Dock (Dojo.app), or run npm run dev.',
    desktop: 'Backups need the Dojo server. Quit Dojo and open it again.',
  },
  rejectedKept: {
    web: 'They are still in this browser.',
    desktop: 'They are still in this window.',
  },
  readOnlyPass: {
    web: 'Your pass is saved, but this browser is read-only.',
    desktop: 'Your pass is saved, but this window is read-only.',
  },
  quotaFull: {
    web: 'Storage full — free space in browser settings',
    desktop: 'Storage full — free some space on this Mac',
  },
  storageTitle: {
    web: 'Browser storage unavailable (private mode or blocked?): ',
    desktop: "Dojo's storage is unavailable: ",
  },
  storageHelp: {
    web: "Dojo keeps all progress in this browser's IndexedDB. Allow site storage (leave private/incognito mode, or unblock storage) and reload.",
    desktop: 'Quit Dojo and open it again. Your saved data stays on disk.',
  },
  startStep1: {
    web: 'Open Dojo from the Dojo app, which starts the Dojo server.',
    desktop: 'Quit Dojo (⌘Q).',
  },
  startStep2: {
    web: 'If it is already open, quit it and open it again.',
    desktop: 'Open Dojo again from Applications or the Dock.',
  },
  startStep3: {
    web: 'Then reload this page. Your saved data stays on disk.',
    desktop: 'Your saved data stays on disk.',
  },
  helperUnreachable: {
    web: 'The AI helper is not running. Start it with npm run helper.',
    desktop: 'The AI helper is not running. Quit Dojo and open it again.',
  },
} satisfies Record<string, Copy>

/** The text for where Dojo is running. */
export const copy = (k: keyof typeof COPY, desktop: boolean = DESKTOP): string => (desktop ? COPY[k].desktop : COPY[k].web)
