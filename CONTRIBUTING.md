# Contributing to Dojo

Thanks for helping. Dojo is a small, local-first app; changes are welcome as issues and pull requests. Read
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first for how the pieces fit together.

## Setup

You need everything in the README's [prerequisites](README.md#prerequisites) (macOS, Node 22.13 or later, and Go if
you work on the Go runner). All commands run from the repository root.

```bash
cd app
npm ci
npx playwright install chromium     # once, for the end-to-end suites
```

Development never touches your real data: the dev scripts refuse `~/Dojo` and port 8787.

## Running the app in development

| Command | What it does |
|---|---|
| `npm run dev` | Vite on http://127.0.0.1:8790 (`DOJO_PORT`) plus `dojo-server --fake` on 8789 (`DOJO_SERVER_PORT`) with its data in `.dojo-dev/`. Vite proxies `/db`, `/ai` and `/tools` to it. The AI is the in-page fake. `DOJO_DEV_DISK=off` starts Vite alone (Dexie only, "Not saved to disk"). |
| `npm run dev:ai` | The same, with AI jobs sent to the helper. Start `npm run helper` (real `claude`) or `npm run helper:fake` in a second terminal first. |
| `npm run helper` / `npm run helper:fake` | The AI helper on 127.0.0.1:8788: real mode spawns `claude -p`, fake mode returns canned `[fake:<job>]` answers and never spawns anything. |
| `npm run server` / `npm run server:fake` | `dojo-server` serving a build. Needs an explicit `DOJO_HOME` and refuses `~/Dojo`. |
| `npm run desktop` | Builds and opens the Electron app from the source tree. **Set `DOJO_HOME` to a scratch folder first**, for example `DOJO_HOME=/tmp/dojo-desktop npm run desktop`; without it the app opens `~/Dojo`. |
| `npm run build` | Type-checks and builds the web app into `dist/`. |

## Tests

| Command | Suite | Notes |
|---|---|---|
| `npm test` | Unit and component tests (Vitest, jsdom), `tests/unit/` | Pins `TZ`; at most two workers. `npm run test:watch` for watch mode. |
| `npm run typecheck` | TypeScript, no emit | |
| `npm run e2e` | End-to-end (Playwright, Chromium), `tests/e2e/` | Three projects: `chromium` (Vite dev on Dexie alone), `storage` (builds the app once and runs its own `dojo-server` with a temp `DOJO_HOME` per test) and `real` (a subset with disk sync on). Starts `npm run dev` itself; one worker, no retries. |
| `npm run e2e:desktop` | The packaged Mac app (Playwright's Electron driver), `tests/desktop/` | Builds `Dojo.app` once into a temp folder (a few minutes) and launches it with temp data folders and the fake AI. Never uses `~/Dojo` or `~/Applications`. |
| `npm run parity:today`, `parity:ai`, `parity:labs`, `parity:designs` | Screenshot parity against the design prototypes, `tests/parity/` | Needs the design prototypes, which are not in this repository (see "Known gaps"). `:update` variants rewrite the baselines. |
| `npm run css:check` | Bare CSS class names defined in more than one file | |
| `npm run bundle:check` | Entry-chunk size budget | Run after `npm run build`. |
| `DOJO_REAL_SMOKE=1 npm run smoke:real` | One real Claude call through the helper | Spends one Sonnet call on your Claude Code login. Refuses without `DOJO_REAL_SMOKE=1`. No other test calls the real `claude`. |

Before a pull request, run at least `npm run typecheck`, `npm test` and `npm run e2e`. Run `npm run e2e:desktop` when
you touch `electron/`, `scripts/install-app.mjs` or the server's startup.

### Known gaps in the public repository

A few unit tests (`ai-guardrails`, `ai-validate`, `ai-types`, `engines`, `diagram-kit`, and those using
`tests/helpers/plan.ts` `legacyPlan()`) and the parity suite read fixtures and design prototypes from outside this repository root
that are not part of this repository, so they fail here. Moving those fixtures into `tests/fixtures/` is a
welcome contribution.

## Private build and the public release

The maintainer's private repo keeps five third-party problem lists under `src/content/banks-private/` (built by
`npm run banks:build` from `scripts/banks-private/`). They are the default build. The public release ships none:
`DOJO_BANK_PACKS=public` builds with the empty pack module, and the maintainer's extract script
writes the public tree without the private paths. A public clone has no
`banks-private`, so the Banks screen shows the Plan bank and Mine; supply your own packs with
`DOJO_BANK_PACKS=/path/to/packs.ts` (same shape as `src/content/banks/packs.ts`). Tests use `DOJO_BANK_PACKS=fixtures`.

## Other scripts

| Command | What it does |
|---|---|
| `npm run helper:gen` | Regenerates `server/gen/ai-shared.mjs` (the helper's copy of the prompts, validators and guardrails) from `src/ai/`. Run it after changing anything under `src/ai/`; a unit test fails when the two drift. |
| `npm run engines` | Re-copies the vendored drawing engines into `public/engines/` from the design prototypes (not in this repository; the copies in `public/engines/` are the source of truth here). |
| `npm run db:export-pg` | Dumps `DOJO_HOME/dojo.db` as Postgres SQL into `DOJO_HOME/export/`. |
| `npm run install:app` / `npm run uninstall:app` | Builds and installs, or removes, `~/Applications/Dojo.app` (see the README). |

Pyodide is copied from the pinned `pyodide` package into the build by a Vite plugin (`scripts/vendor-pyodide.mjs`),
together with its licence.

## Conventions

- **Local first.** No network calls besides the existing link check, no telemetry, no API keys. AI goes through the
  user's own `claude` CLI only.
- **Tests with every change.** Rules live in `src/rules/` as pure functions with unit tests; screens get component
  or end-to-end tests. Keep end-to-end tests independent of each other.
- **No personal data.** Keep personal paths, names and private links out of the tree.
  Use placeholders such as `https://github.com/example-user/...` in fixtures.
- **Licences.** A new runtime dependency or vendored file needs a row and its licence text in
  [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). Only permissive or file-level copyleft (MPL-2.0) licences.
- **Commits.** Conventional style, for example `fix(dojo): ...` or `feat(dojo): ...`, one logical change each.

## Licence

By contributing you agree that your contributions are released under the project's [MIT License](LICENSE).
