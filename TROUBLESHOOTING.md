# Troubleshooting Dojo

Start with the logs: **Help › Open Logs Folder** in the app, or `~/Dojo/logs/`. Your data is in `~/Dojo/dojo.db`,
with backups in `~/Dojo/backups/`. Nothing below deletes data unless it says so.

## Installing

### `npm ci` or `npm run install:app` fails

- **Node too old.** Dojo needs Node 22.13 or later (`node --version`). Older versions lack the built-in
  `node:sqlite`. Install a current Node from https://nodejs.org, with `brew install node`, or with nvm
  (`nvm install` in the repo root reads `.nvmrc`).
- **Run it from the repo root.** The `package.json` with the scripts is there.
- **Electron download blocked.** `npm run install:app` downloads the Electron runtime from GitHub on its first run (`npm ci` does not: recent Electron has no postinstall step, and npm 11 skips dependency install scripts). Behind a proxy or firewall, set
  the usual npm proxy settings, or Electron's `ELECTRON_MIRROR`, and retry; `node node_modules/electron/install.js` fetches it by hand.
- **"icon skipped (...)".** The Dock icon is built with macOS's `sips` and `iconutil`. If that fails the app is still
  installed, with Electron's default icon. `--no-icon` skips it on purpose.

### macOS says Dojo cannot be opened

`npm run install:app` builds Dojo on your Mac and signs it ad hoc; it is not signed with an Apple Developer ID or
notarized. A copy you built yourself normally opens directly. If macOS blocks it (for example a copy moved from
another Mac, or after a macOS update):

1. In Finder, open `~/Applications`, **right-click (or Control-click) Dojo › Open**, then **Open** in the dialog.
   You only need to do this the first time.
2. If there is no Open button (recent macOS versions), open **System Settings › Privacy & Security**, scroll to the
   message about Dojo, and click **Open Anyway**.

Reinstalling with `npm run install:app` also gives you a fresh, locally signed copy.

## Starting

### "Dojo could not start its server: ..."

The app's built-in server failed before the window opened. The message says why, and `~/Dojo/logs/` has the details.
Common causes:

- `~/Dojo` (or the folder you chose with `--home`) is not writable, or the disk is full.
- The database is damaged. Quit Dojo, move `~/Dojo/dojo.db` aside (do not delete it), copy the newest file from
  `~/Dojo/backups/` to `~/Dojo/dojo.db`, and open Dojo again.

### "Dojo couldn't start"

The window opened but could not load your data from the server. Follow the steps on the page: quit Dojo (⌘Q) and open
it again. Your saved data stays on disk. If it keeps happening, check `~/Dojo/logs/`.

### "Storage problem" or "Plan data problem"

"Storage problem" means the window's own storage could not open; quit and reopen Dojo. "Plan data problem" means the
plan file could not be read or reconciled; if you edited `public/data/plan.json`, check it is valid JSON and
reinstall.

### Opening Dojo again focuses the old window

That is by design: Dojo runs one instance per data folder. A second launch hands over to the first one.

## Saving

The header shows **Saved**, **Saving…** or **Not saved to disk**. Hover over "Not saved to disk" for the reason.

- **"Reopen Dojo from the Dojo app".** Only the Dojo app window may write. A page opened any other way is a
  read-only view.
- **Not saved to disk for a long time.** The window keeps a working copy and retries. Quit Dojo with ⌘Q (it flushes
  what it can), open it again, and check `~/Dojo/logs/`. **Settings › Changes that couldn't be saved** lists anything the server
  refused.
- **Restore a backup.** **Settings › Backups** lists the daily and manual snapshots. Restoring one first saves the
  current database as `pre-restore-<time>.db` in the same folder, so a restore can be undone.

## AI features

### "Claude Code is not installed or not on PATH."

This is the "needs Claude Code" state. AI features (briefs, hints, checks, grading, reviews and the rest) run the
`claude` CLI with your own Claude Code login; everything else in Dojo works without it. To turn them on:

1. Install Claude Code (https://docs.claude.com/en/docs/claude-code) and run `claude` once in Terminal to log in.
2. Check that a login shell finds it: `zsh -lc 'command -v claude'` should print a path.
3. Quit Dojo (⌘Q) and open it again, then press **Retry** on the AI panel.

Dojo looks for `claude` on your login shell's `PATH`, then in `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`
and the newest nvm Node. It never stores an API key.

### Other AI messages

| Message | What to do |
|---|---|
| The AI helper is not running. Quit Dojo and open it again. | Do that; the helper is part of the app. |
| The AI helper timed out. | Press **Retry**. A single call is stopped after 90 seconds. |
| The AI helper is busy. Try again in a moment. | At most two AI jobs run at once. Wait, then **Retry**. |
| The AI helper failed. / The AI returned something unusable. | Press **Retry**. Check that `claude` works in Terminal and that you are logged in. |
| That request is not allowed before you give up. | Some help (for example a full solution) unlocks only after you give up on the problem. |
| Set your project repo to let the grader read your commits ... | Optional. Add `"projectRepo": "<path>"` to `~/Dojo/profile.json` (see the user guide), then restart Dojo. |

## Code runners

### "Go isn't installed: install it with brew install go"

Install Go 1.22 or later (`brew install go`, or https://go.dev/dl), then quit and reopen Dojo so it finds the new
`go`. Dojo looks on your login shell's `PATH`, then in `/opt/homebrew/bin`, `/usr/local/go/bin`, `/usr/local/bin` and
`~/go/bin`. Runs build offline (`GOPROXY=off`, `GOTOOLCHAIN=local`), so an older Go refuses to build instead of
downloading a newer one. The first run after a fresh install takes a few seconds while the build cache fills.

### "sandbox-exec is missing: the Go runner needs macOS"

Go runs execute under macOS's built-in `/usr/bin/sandbox-exec`. It ships with macOS; this message means it is missing
or not executable on this system.

### A Go run says timeout, output or memory limit

Runs are limited to 3 seconds, 1 MiB of output and 512 MiB of memory, one run at a time. An infinite loop or a very
large allocation hits these limits; fix the code and run again.

### "Python could not start. Reload Dojo and try again."

The Python runner (Pyodide) runs inside the app window. Quit Dojo (⌘Q) and open it again.

## Sound

### The focus/break chime is silent

Dojo plays a short chime when a focus or break block ends. Check the Mac's output device and volume first. If no app
can play sound, the macOS audio service may be wedged; restart it in Terminal (it asks for your password):

```bash
sudo killall coreaudiod
```

macOS starts it again within a few seconds.

## Still stuck

Open an issue with your macOS version, `node --version`, `go version` (if relevant), what you did, and the relevant
lines from `~/Dojo/logs/`. Check the log lines for anything private (your plan text, paths) before you paste them.
