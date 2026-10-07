# Dojo architecture

This document is for contributors: how Dojo is put together, where the code lives, how data moves, and which rules
keep it safe. For using the app see [USER-GUIDE.md](../USER-GUIDE.md); for development commands and the test suites,
[CONTRIBUTING.md](../CONTRIBUTING.md); for a broken install, [TROUBLESHOOTING.md](../TROUBLESHOOTING.md).

In short: an Electron 44 shell (`electron`) runs a standard-library Node server (`server`) in its own main
process. The server serves the Vite + React 18 + TypeScript front end (`src`), owns the SQLite database
(built-in `node:sqlite`), runs Go code under the macOS sandbox, checks links, and runs AI jobs through the user's
`claude` CLI. The front end renders from a working copy in IndexedDB (Dexie) and runs Python in Pyodide inside a
sandboxed frame. There is no cloud component and no account; the server binds to `127.0.0.1` only.

Paths are relative to the repository root (`<repo>`); the application is at the repository root. `<home>` is the data folder,
`~/Dojo` for the installed app.

**Contents:** [Process model](#process-model) · [Source tree](#source-tree) · [Front end](#front-end) ·
[Data flow and storage](#data-flow-and-storage) · [HTTP routes](#http-routes) ·
[Security boundaries](#security-boundaries) · [The plan data model](#the-plan-data-model) ·
[The AI job pipeline](#the-ai-job-pipeline) · [The code runners](#the-code-runners) ·
[Vendored assets](#vendored-assets) · [Tests](#tests) ·
[Environment variables and flags](#environment-variables-and-flags) · [Known gaps](#known-gaps)

## Process model

`npm run install:app` (`scripts/install-app.mjs`) builds `Dojo.app` with electron-builder (no asar, signed ad hoc).
When it starts:

1. `electron/main.mjs` resolves the data folder (`DOJO_HOME`, else a home baked into `Resources/dojo.json` at
   install time, else `~/Dojo`), points Chromium's user data at `<home>/electron`, takes the single-instance lock,
   and builds a PATH from the login shell plus the usual install locations (`electron/env.mjs` `toolPath`), since
   an app started from the Dock gets a bare PATH. The Go runner and the AI helper find `go` and `claude` on it.
2. It imports `server/dojo-server.mjs` **in the same process** and starts it with `--real`, `--dist <app>/dist`,
   `DOJO_HOME=<home>` and port 0, reusing the last port in `desktop.json` while it is free, so the window keeps its
   origin (and so its IndexedDB working copy) across launches. Port 8787 is never used. On listen the server opens
   `dojo.db`, runs migrations, creates `writer.token` if missing, takes the day's backup if there is none and starts
   a 24-hour backup timer; main then sweeps run leftovers of an earlier crash.
3. Main opens one `BrowserWindow` (context isolation, no Node integration, renderer sandbox, no preload) at
   `http://127.0.0.1:<port>/#writer=<token>`. The page moves the token into `localStorage` and strips it from the
   URL. That window is **the writer**.
4. Quitting runs `gracefulStop`: the Go run in flight is killed, the server closes (an open AI request's `claude`
   process group is killed when its connection drops), and a shutdown sweep cleans up.

```text
 Dojo.app
 +----------------------------------------------------------------------------------+
 | Electron main process (electron/main.mjs)                                        |
 |   dojo-server (server/dojo-server.mjs), in-process, 127.0.0.1:<free port>        |
 |     |-- static dist/ + /data/plan.json (+ profile.json overlay)                  |
 |     |-- /db/*            -> db/manager.mjs -> db/store.mjs -> db/adapter.mjs     |
 |     |                       -> node:sqlite -> <home>/dojo.db, <home>/backups/    |
 |     |-- /tools/run-go    -> runner/runner.mjs -> go build + sandbox-exec (child) |
 |     |-- /tools/packs/*   -> runner/packs/<id>/pack.json (public part only)       |
 |     |-- /tools/linkcheck -> linkcheck.mjs -> HEAD/GET to public http(s) URLs     |
 |     '-- /ai/*, /health   -> helper.mjs -> claude-runner.mjs -> claude -p (child) |
 +----------------------------------------------------------------------------------+
            ^ HTTP on loopback
            |
 +----------------------------------------------------------------------------------+
 | BrowserWindow (Chromium renderer, sandboxed), the writer                         |
 |   React app (src/)                                                               |
 |     |-- Dexie: IndexedDB "dojo-disk" (working copy) + _outbox <-- sync -->  /db  |
 |     |-- AI client (src/ai/client.ts)                           -------->  /ai    |
 |     |-- Go code panel                                          -------->  /tools |
 |     '-- Python: sandboxed iframe /pyrunner/frame.html -> Web Worker -> Pyodide   |
 +----------------------------------------------------------------------------------+
```

Outside the app the same server runs as a plain Node process: `npm run server` (needs an explicit `DOJO_HOME` and
`DOJO_PORT`; refuses `~/Dojo` and 8787) and `npm run dev` (Vite on 8790 proxying `/db`, `/ai` and `/tools` to
`dojo-server --fake` on 8789 with data in `.dojo-dev`; it prints a "dev writer URL" carrying the token).

## Source tree

| Path | What it holds |
|---|---|
| `electron/` | `main.mjs` (data home, single instance, menu, in-process server, writer window, shutdown); `env.mjs` (`resolveHome`, `toolPath`). |
| `server/dojo-server.mjs` | The HTTP server and its CLI: static files, the plan overlay, `/db`, `/tools`, and the helper routes. |
| `server/helper.mjs`, `claude-runner.mjs` | AI routes, request validation, Host and Origin rules (the helper also runs standalone); spawning `claude -p`, envelope parsing, retry, git evidence. |
| `server/shared-entry.ts`, `gen/ai-shared.mjs` | The app's prompts, guardrails, validators and fake outputs, bundled for Node by `npm run helper:gen`. |
| `server/profile.mjs`, `linkcheck.mjs` | `<home>/profile.json` (plan overlay, project repo); the link check. |
| `server/db/` | `adapter.mjs` (SQLite seam), `store.mjs` (documents and op history), `manager.mjs` (open, migrate, writer token, backups, restore), `log.mjs`, `migrations/*.sql`. |
| `server/runner/`, `shared/` | `runner.mjs` (packs, harness, sandboxed build and run, limits, sweeps), `pyframe.mjs` (Python asset rules, frame CSP), `tk/` (Go step toolkit), `packs/<id>/`; `shared/stepShape.mjs`, the step shape both runners produce. |
| `src/app/` | `App.tsx` (boot and error states), `Shell.tsx` (top bar, footer, global hooks), `routes.tsx`, `tabs.ts`, `shortcuts.ts`, `StartGate.tsx`. |
| `src/screens/` | One component per route, plus subfolders for Do, briefs, design sessions, the AI tab, Atlas, Banks and Progress. |
| `src/data/` | Dexie schema (`db.ts`), row types (`types.ts`), write actions (`*Actions.ts`), live-query hooks, the writer token (`writer.ts`), plan load and reconcile (`seed.ts`), `sync/`. |
| `src/rules/` | Pure domain logic, no React and no Dexie: sprints, board moves, XP, help ladder, redos, workload, reconcile, reviews. Most unit tests point here. |
| `src/ai/` | The AI job contract (`types.ts`), `client.ts` (`runJob`), the fake provider, prompts, guardrails, validators. |
| `src/runner/`, `src/study/` | Code panel, CodeMirror editor, Go client, Python frame protocol (`py/`), trace and DP views; the study-session runner. |
| `src/content/`, `ui/`, `lib/`, `styles/` | Static text and bank datasets; shared components and charts; utilities; design tokens and CSS. |
| `public/` | `data/plan.json` (the sample plan), `engines/` (vendored renderers, three.js), `pyrunner/` (Python frame, worker, judge, harness, toolkit), `fonts/`. |
| `scripts/` | Install and uninstall, dev launcher, Postgres export, helper bundle, vendoring, bundle and CSS checks, the real-Claude smoke test. |

## Front end

- **Routing.** `BrowserRouter`; `routes.tsx` maps one path per screen plus `/do/:ticketId` and
  `/designs/session/:designId` (full-screen, global shortcuts off); anything else redirects to `/`. Today and DSA
  are eager, the rest lazy, so the entry chunk stays under 480 KB (`npm run bundle:check`). `tabs.ts` holds tab
  order, the More menu and the single-key shortcuts.
- **Layers.** Screens read through live queries (`dexie-react-hooks`) and write through action functions in
  `src/data`, which run Dexie transactions; decisions live in `src/rules`. `safeWrite` turns failed writes into toasts.
- **Boot.** `main.tsx` starts disk sync (a lazy chunk). A window with a working copy renders at once and reconciles
  after the first sync; otherwise it shows "Loading…" (after 300 ms) until the sync ends, and a first sync that
  fails or takes over 10 s shows "Dojo couldn't start" rather than onboarding. `App.tsx` fetches `/data/plan.json`,
  reconciles plan cards (writer only) and shows onboarding until a start date is set. A bad plan shows "Plan data
  problem"; an IndexedDB failure, "Storage problem".
- **Engines.** Charts, the mascot stage, the algorithm players and the diagram renderer are prebuilt scripts in
  `public/engines`, loaded on first use by `src/lib/engines.ts` as custom elements (`sr-chart`, `pom-stage`,
  `sr-algo`, `sr-algo2`, `sr-diagram`; `atlas-pieces.js` sets a global). `src/lib/platform.ts` swaps a few
  messages when the user agent is Electron, since the same build also runs in a browser.
- **Local state.** The timer, the study session, a few view preferences and the writer token live in
  `localStorage` (`dojo-timer`, `dojo-study`, `dojo-cycle:<id>`, `dojo-gaveup`, `dojo.writer` and similar).
  Everything that matters is in IndexedDB and on disk.

## Data flow and storage

**Two copies, one source of truth.** `<home>/dojo.db` is the source of truth. Each window keeps a working copy in
IndexedDB: `dojo-disk` in the writer, `dojo-view` in a read-only window (no token), `dojo` in builds with
`VITE_DOJO_DISK=off` (Dexie only, used by most browser e2e tests). App tables (Dexie schema version 7): `tickets`,
`sessions`, `events`, `settings`, `rungUses`, `redos`, `aiLog`, `pictures`, `atlasRuns`, `designSessions`,
`artifacts`, `stageCells`, `blankTests`, `grades`, `bankItems`, `checkAttempts`, `reviews`, `code`. Tables starting
with `_` (`_outbox`, `_meta`) are bookkeeping and never synced. Versions only add tables, except 6 and 7, which
re-key `code` by `[ticketId+lang]`.

### Writing

```text
 screen -> data/*Actions.ts -> Dexie transaction on app tables
             + outbox middleware (sync/middleware.ts): _outbox rows (put/delete/clear + opId), same transaction
 sync loop (sync/loop.ts): ~300 ms debounce, <= 500 ops per POST, backoff 0.5-5 s, keepalive send on page hide
   -> POST /db/ops { clientId, dbId, ops[] } + X-Dojo-Writer
   -> store.applyOps, one SQLite transaction:
        dojo_ops   append-only history (seq, at, client_id, tbl, op, id, doc, op_id)
        dojo_docs  current state (tbl, id, doc, updated_at, deleted)
```

Outbox rows are deleted only after a 200, and the server skips op ids it has already applied, so retries are safe.
Deletes are tombstones; `dojo_ops` is never updated or deleted. Append-only tables (`events`, `aiLog`, `atlasRuns`)
use `++seq` keys locally and `<clientId>:<seq>` on disk (`sync/diskIds.ts`); the server refuses a new row that would
overwrite an existing id, and another client's edit unless it is marked as a known (hydrated) row. Refused changes
are parked in `_meta` (up to 200), listed in Settings with Retry, and block a restore. The header's save status comes
from `sync/status.ts`.

### Reading at boot (hydrate)

Every database has an id (`dojo_meta.db_id`). A window adopts one and stamps every post with it; a post to another
database gets `409 db_mismatch`, which triggers re-adoption. At boot `sync/hydrate.ts` either (a) flushes the outbox
and then replaces the working copy with `GET /db/state`, when the window adopted this database (`_meta.syncedDb`);
(b) adopts the database and sends its outbox, when the window never synced and the disk is empty (the fresh start);
or (c) lets the disk win, replacing the working copy and dropping pending outbox rows. A read-only window only copies
the disk's state into `dojo-view`, never posts, and refuses every write with "Read-only: open Dojo from the Dojo
app to make changes".

### Backups, restore, schema

- `VACUUM INTO` snapshots in `<home>/backups/`: `dojo-YYYY-MM-DD.db` (daily: on start if missing, then every 24 h)
  and `dojo-YYYY-MM-DD-HHMMSS.db` (Back up now). Each kind keeps its newest 30, listed and pruned by file name only;
  `pre-restore-<ISO time>.db` copies are never pruned.
- **Restore on the server** (`manager.mjs`): probe the backup read-only (`PRAGMA quick_check`), copy it to a temp
  file, snapshot the live database as `pre-restore-<time>.db`, migrate the copy, append the op history recorded since
  the backup plus one `restore` op, give it a new `db_id`, fsync, rename it over `dojo.db`, drop the old WAL files and
  reopen. Any failure reopens the old contents.
- **Restore in the page** (`Backups.tsx`, `sync/boot.ts`): refuse while refused changes are parked; flush; mark the
  restore in `_meta` and tell every Dojo tab over a `BroadcastChannel` to stop syncing; post the restore; wipe the
  local copy; reload, so the next boot hydrates from the restored database.
- **Schema.** Plain SQL migrations in `server/db/migrations/`, recorded in `dojo_schema_migrations` and portable
  to Postgres; `adapter.mjs` is the storage seam (only `SqliteAdapter` exists). `npm run db:export-pg` writes a
  read-only Postgres SQL dump (`doc` columns as `jsonb`) to `<home>/export/`.
- **Data folder** (listed in the user guide): `dojo.db` runs in WAL mode with `synchronous = FULL`; the log rotates
  at 5 MB. The folder is 0700; the database, its WAL files, backups and the token are 0600.

## HTTP routes

Every request first passes the Host pin and an Origin allow-list (see [Security boundaries](#security-boundaries)).
POST bodies must be `application/json`. `/db` and `/ai` errors are `{ "ok": false, "error": { "code", "message" } }`;
`/tools/run-go` errors are `{ "error": "<code>" }`.

| Route | Writer token | Purpose |
|---|---|---|
| `GET`/`HEAD /*` | No | The built app from `dist/`, SPA fallback to `index.html`. Hashed `/assets/*` are immutable. A missing file with an extension is a 404. |
| `GET /data/plan.json` | No | The shipped plan with `profile.json`'s `plan.schedule` and `plan.learner` laid over it, read per request. |
| `GET`/`HEAD /pyodide/*`, `/pyrunner/*` | No | Pyodide and the Python frame. The only routes that accept `Origin: null` (the sandboxed frame), with CORS `*` and strict path checks. |
| `GET /db/health` | No | `ok`, `dbPath`, `dbId`, `docs`, `ops`, `lastBackup`, `home`, `projectRepo`. |
| `GET /db/state`, `/db/backups` | No | Every live document grouped by table; `{ backups: [{ file, bytes, at }] }`, newest first. |
| `POST /db/ops` | Yes | Apply a batch of ops (body up to 5 MiB; other POSTs 64 KiB). |
| `POST /db/backup`, `/db/restore` | Yes | Take a manual snapshot; restore `{ file }`. |
| `POST /tools/linkcheck` | Yes | `{ urls }` to `{ ok, results: [{ url, ok, status }] }`. |
| `GET /tools/packs/<id>` | No | The public part of a problem pack (never `ref.go`). |
| `POST /tools/run-go` | Yes | `{ pack, code, mode: "run" or "submit" }`. One run at a time (`409 busy`); body up to 512 KiB, code 64 KiB. |
| `GET /health` | No | Helper status (mode, model, `claude` found, jobs in flight, `projectRepo`). |
| `POST /ai/<job>` | Yes | One job, `{ ticket, context }` to `{ ok, job, ticketId, output, ms, mode }`. |

## Security boundaries

- **Loopback and Host pin.** The server (and the standalone helper) listens on `127.0.0.1`, and every request's
  `Host` must be `127.0.0.1:<port>` or `localhost:<port>` of the socket, which blocks DNS rebinding.
- **Origin allow-lists.** A request carrying `Origin` must come from an allowed one. `/db` and `/tools`: the server's
  own origin and `DOJO_DB_EXTRA_ORIGINS`. AI routes: the own origin, `DOJO_HELPER_ORIGINS` and `DOJO_DB_EXTRA_ORIGINS`;
  only dev (`npm run dev`, which serves no `--dist`) and the standalone helper also allow the fixed dev and test ports
  (8787, 8790 to 8798). Requiring `application/json` forces a CORS preflight on cross-origin browsers.
- **Writer token.** 32 random bytes in `<home>/writer.token` (0600), created once. Every write to `/db`, the link
  check, the Go runner and every AI job need it in `X-Dojo-Writer`, compared in constant time. In the app only the
  Electron window receives it. Reads (`GET /db/*`, `/health`) need no token.
- **The window** never leaves the app's origin, and no frame leaves the app's files. A link opens in the default
  browser only when it is `http(s)` to a public host; one to this Mac or the local network asks first (Cancel is the
  default), and other schemes never open. New windows are denied. The session grants no permission (camera,
  microphone, location, notifications, clipboard read, devices).
- **Content-Security-Policy** (`server/csp.mjs`) on every app file: scripts, connections, fonts, frames and workers
  from the app's own origin only, no inline script and no `eval`, inline styles allowed (the engines' shadow roots),
  `object-src`, `base-uri`, `form-action` and `frame-ancestors 'none'`. Also `X-Frame-Options: DENY` and `nosniff`.
  Vite dev adds only its inline preamble, HMR and the loopback helper.
- **Real data stays out of dev and tests.** `npm run server`, `npm run dev` and the tests refuse `~/Dojo` (case-folded,
  symlinks resolved) and port 8787; only the app passes `--real`. Vite dev never serves `server/` or any `ref.go`.
- **Link check (SSRF rules).** `http(s)` only, URLs up to 2048 characters, at most 50 per request, 10 at a time, 5 s
  per URL (HEAD, then GET if the HEAD fails), no redirects. Addresses are checked after DNS resolution: private,
  link-local and loopback ones are refused, including IPv6 forms that embed an IPv4 address. Only the e2e harness may
  allow loopback (`--linkcheck-allow-loopback`). Nothing else in the server contacts the network.
- **AI isolation.** No API keys: the helper spawns the user's own `claude` and login. Each call runs in a fresh, empty
  temp directory with tools, MCP servers, hooks and slash commands off and no session persistence. Learner text is
  fenced as data (`<<<LEARNER_TEXT ... LEARNER_TEXT>>>`); outputs are validated on the server and again in the page.
- **Grader repo access.** The grade job reads a local repo only when a project repo is set (`DOJO_PROJECT_REPO`, else
  `projectRepo` in `profile.json`) and the requested path resolves, after `~`, `..` and symlinks, to that repo or
  inside it; otherwise `path_not_allowed`. The page asks only when the artifact's repo URL ends with the local repo's
  folder name. Git runs read-only (`log --oneline -n 20`, `show --stat`, `diff --stat`) with external diff and
  textconv off, hooks at `/dev/null`, fsmonitor off, a 10 s timeout and 8000 characters per command.
- **Runners** are sandboxed; see [The code runners](#the-code-runners).

## The plan data model

The plan is `public/data/plan.json`, typed as `PlanJson` in `src/data/types.ts`. `loadPlan`
(`src/data/seed.ts`) requires a non-empty `sprints` array, a `rotation` object and `dsa_bank` and `design_bank`
arrays; `planToTickets` (`src/rules/planTickets.ts`) throws `PlanDataError` on what it cannot use (missing or
duplicate ids, non-array links), and the app shows "Plan data problem".

| Key | Shape | Used for |
|---|---|---|
| `planVersion`, `generated` | string | Shown in Settings (`planVersion`, else `generated`). |
| `idMap` | `{ oldId: newId }` | Renames: progress on an old id moves to the new one at reconcile. |
| `sprint_days`, `total_sprints` | number | In the type, not read: the app uses 14 days and 72 sprints (`src/rules/sprint.ts`). |
| `rotation` | `{ Mon..Sun: role }` | Weekday roles on Week, Ritual and Today. |
| `sprints[]` | `{ sprint, block, block_title, block_theme, focus_ai, focus_interview, ai[], interview[], proof }` | Task cards per sprint. |
| `sprints[].ai[]`, `.interview[]` | `{ id, skill, text, links[{label,url}], kind?, stage?, session? }` | `kind`: `task` (default), `watch`, `read` or `stage`; stage cards carry `stage` and `session` (`watch`, `rebuild`, `build`, `teachback`). |
| `dsa_bank[]` | `{ sprint, topic, pattern, note, problems[{ num, name, url, difficulty E/M/H, premium? }] }` | Problem cards with id `p<num>`. |
| `design_bank[]` | `{ tier, skill, items[{ id, title, difficulty, deep_dives[], refs[] }] }` | Design cards, spread over the range in the tier name ("... (sprints A to B)"), else 1 to 72. |
| `phases[]`, `skills[]` | `{ n, months[], note }`; `{ id, label, tier, needs[], what, why }` | Map: Journey and Skill tree. Optional. |
| `communities[]`, `ai_shelf[]` | `{ n, k, u, fit, how, lane }`; `{ skill, text, links[], from? }` | Mentors (`lane`: `learner`, `contributor`, `program`); the AI tab's Optional shelf. Optional. |
| `schedule` | `PlanSchedule` (partial) | Ritual, Today and Overview text. Missing keys fall back to `src/content/schedule.ts`. |
| `learner` | `{ patternsRepo? }` | Resolves links written as `{{learner.<key>}}`; such links are dropped while unset. |

**Cards (tickets).** Every card is a `Ticket` row: `id`, `origin` (`plan`, `bank:<id>`, `mine`, or the parent id of
a split session), `track`, `kind`, `plannedSprint` and current `sprint`, `status` (`todo`, `doing`, `done`, `slid`),
`xp`, and optional brief, deliverable, pin, roll-over and split fields. A plan task's title is the first sentence of
its `text` (at most 72 characters). Default minutes: 50 for task, watch, read and stage; 30 for problems; 45 for
designs. Base XP: 10, 5/10/15 by problem difficulty, and 20 for a design. Roll-over, slides and rebalancing are
rules in `src/rules/sprint.ts`, `slide.ts` and `workload.ts`; moves are `events` rows, which Undo reverses.

**Reconcile.** On every boot the writer runs `runReconcile` (`src/data/seed.ts`, rules in `src/rules/reconcile.ts`):
ids still in the plan keep their progress (status, sprint, XP, slides) and get fresh content; new ids become `todo`
cards in their planned sprint; ids that left the plan are archived with their XP, unless `idMap` maps them, in which
case they merge into the target and their sessions and events follow. Bank, Mine and split cards are left alone.
`server/profile.mjs` replaces only the top-level `schedule` and `learner` keys when serving `/data/plan.json`.

## The AI job pipeline

`src/ai/types.ts` `JOB_NAMES` lists eleven jobs (`GET /health` lists the first eight; all are served). Each request
carries `ticket` (id, title, text, track, pattern, difficulty, links; `null` where marked) and a per-job `context`:

| Job | Called from | Context sent |
|---|---|---|
| `hint` | Do, help ladder | `level` 1 or 2, the attempt log |
| `picture` | Do, help ladder, problems | the attempt log, `language: "python"`; returns a step walkthrough |
| `diagram` | Do ladder on designs; design session reference | deep dives, reference links |
| `solution` | Do, after Give up | `gave_up: true`, the attempt log, the picture already shown |
| `interview` | Design session, Interviewer mode | turn, answers, deep dives, transcript; `final` for the grade |
| `grade` | AI tab artifacts; Get feedback on a deliverable | proof note, repo URL, commit, commit summary, stage, rubric; `repoPath` adds git evidence |
| `suggest_slide` | Today, Load check (`ticket: null`) | candidate cards (title, track, minutes, difficulty, times slid), how many, pace, next sprint's cards |
| `classify` | Banks Mine; Atlas search fallback (`ticket: null`) | the pasted URL or name |
| `brief` | Board, Draft briefs | kind, AI-track build flag, learning flag, minutes, sprint, stage and session |
| `check` | Mark done on learning cards | each question with its key ideas and the learner's answer or choice |
| `review_sprint` | Progress Reviews, automatic reviews (`ticket: null`) | the numbers computed by `src/rules/review.ts` |

1. A screen or action calls `callJob` (`src/data/aiActions.ts`), which lazy-loads `src/ai/client.ts`, calls `runJob`
   (never throws) and logs one `aiLog` row. The provider is fixed at build time: the in-page fake (`src/ai/fake.ts`)
   unless `VITE_DOJO_AI=helper`; the `install:app` build also sets `VITE_DOJO_HELPER_URL=self`, so jobs go to
   `/ai/<job>` on the app's own server.
2. The helper (`server/helper.mjs`) checks the request and its per-job context (`solution` needs `gave_up: true`),
   finds `claude` (`DOJO_CLAUDE_BIN` on PATH, else `503 claude_missing`) and allows 2 jobs at once (else `429 busy`).
3. `claude-runner.mjs` runs, in a fresh temp directory with the prompt on stdin:

   ```text
   claude -p --model sonnet --output-format json --tools "" --strict-mcp-config --no-session-persistence
          --setting-sources project --settings '{"disableAllHooks":true}' --disable-slash-commands
          --system-prompt <guardrails for the job>
   ```

   The prompt (`src/ai/prompts.ts`) holds the task, the fenced context, the output schema and one example, plus git
   evidence for `grade`. The reply envelope is parsed and validated with the page's own `validateOutput`; an invalid
   reply is retried once with the error appended. One deadline covers the job (`DOJO_HELPER_TIMEOUT_MS`, 90 s); on
   timeout or a dropped connection the process group gets SIGTERM, then SIGKILL after 2 s.
4. The page validates again and shows the output, or the error message, the raw `code: message` and Retry
   (`src/ui/ai/AiStates.tsx`; codes and messages in `AI_ERRORS`, `src/ai/types.ts`).

**Guardrails** (`src/ai/guardrails.ts`): no complete solution code except `solution` after giving up; no pattern
name in a level-1 hint; word limits (hint 40, interview turn 80, grade 150, solution 300 plus at most 15 lines of
pseudocode); never write code for the learner's capstone repo; no code at all in briefs for AI-track build cards.

**One source for both sides.** `server/shared-entry.ts` re-exports prompts, guardrails, validators and fake outputs
from `src/ai`; `npm run helper:gen` bundles it with esbuild into `server/gen/ai-shared.mjs` (run it after changing
`src/ai`; `node scripts/build-helper-shared.mjs --check` exits 1 when the bundle is stale). `dojo-server --fake`,
`npm run helper:fake`, `npm run dev` and `DOJO_DESKTOP_FAKE_AI=1` never spawn `claude`;
`DOJO_REAL_SMOKE=1 npm run smoke:real` makes exactly one real level-1 `hint` call.

## The code runners

**Packs.** `server/runner/packs/<id>/pack.json` holds the function name, signature, Go starter and cases;
`ref.go`, the reference solution, never leaves the server (`publicPack` strips it). There are 20 packs keyed by
LeetCode number (`p3` to `p1584`); `src/runner/client.ts` lists the ticket ids that show the code panel. Types: `int`,
`string`, `bool`, `[]int`, `[][]int`, `[]string`, `*ListNode`, `*TreeNode`. Run uses the first 2 cases; Submit uses
all, and a passing Submit unlocks Solved on the Do screen.

### Go (`server/runner/runner.mjs`)

Each run gets a fresh temp dir `<tmp>/dojo-run-<server pid>-XXXXXX` holding module `dojo` (`solution.go`, a generated
`dojo_main.go`, the `tk` toolkit) and a temp `HOME`. `go build` runs under one `sandbox-exec` profile and the program
under another, each spawned detached (its own process group).

- **Build profile:** no network; no reads of the app directory (neither an import nor `//go:embed` can reach
  `ref.go`); writes only to the temp dir and `<home>/gocache`. `GOPROXY=off`, `GOTOOLCHAIN=local`, `GOWORK=off`,
  `GOSUMDB=off`, `GOENV=off`, `CGO_ENABLED=0`, telemetry off; `go.mod` says `go 1.22`, so an older Go fails rather
  than downloading a newer one.
- **Run profile:** no network; no `fork`, and `exec` only of its own binary; signals and process info only for
  itself; `sysctl` reads limited to `hw.*` and `kern.os*`; no Mach service lookups or registrations, IOKit, POSIX or
  System V IPC, hard links or kernel-control sockets; no reads of the user's home, the data folder, the app directory,
  `/Users`, `/Volumes`, `/private/var/folders` or `/private/tmp` outside the run's temp dir; writes only there and to
  `/dev/null`; no `chmod` or `chflags`. Environment: `PATH`, `HOME`, `TMPDIR`, `LANG`.
- **Results** come back on fd 3 (toolkit events) and fd 4 (case results); fd 1 is the learner's stdout. A random
  per-run key arrives on fd 5 and every line without it is dropped, so learner code cannot fake results.
  `//go:linkname`, cgo and imports of `os/signal`, `syscall` and `unsafe` are refused before the build. Statuses: `ok`, `compile_error`, `runtime_error`, `timeout`, `output_limit`,
  `memory_limit`, `no_toolchain`.

**Limits:** 3 s wall time; RLIMIT_CPU 4 s soft and 5 s hard plus an in-program guard at 4 s (macOS only sends
SIGXCPU, which Go ignores); 512 MiB RSS (polled) and Go heap; 10,000 goroutines; 1 MiB stdout (64 KiB shown);
20,000 toolkit events; 64 KiB of code; 64 MiB and 10,000 entries in the temp dir. Builds: 30 s, 1 GiB RSS for the
build's process group, 64 MiB per file; the build cache is trimmed past 1 GiB. `go` is `DOJO_GO_BIN` if set, else
`go` on PATH, else `/opt/homebrew/bin/go`, `/usr/local/go/bin/go`, `/usr/local/bin/go`.

**Orphan guards.** A run must never outlive Dojo.

- Timeouts, limits, a dropped client connection and shutdown SIGKILL the run's whole process group and confirm it is
  gone before the temp dir is removed; a dir whose process survived is left for the sweep.
- `tk/internal/wire` runs before any learner code: it unlinks the program's own binary, reads the run key, sets the
  open-file and file-size rlimits (soft and hard, so they cannot be raised), the thread and stack caps and a memory
  and goroutine watchdog, and adds stops that do not depend on the runner: the CPU guard, a wall guard at 3 s plus
  1 s grace, and an exit as soon as its parent is gone (`getppid() == 1`).
- `sweepStaleRunDirs` runs at server start and shutdown: it kills this user's processes whose command line is
  exactly a run's (`<tmp>/dojo-run-*/prog`, or its `go build -o ...`) and whose parent is gone (at shutdown, also
  this server's own), then removes run dirs whose owner pid is dead or that are older than 10 minutes. A standalone
  `dojo-server --parent-pid <pid>` also exits within about 2 s of that process dying.

### Python (`public/pyrunner`, `src/runner/py`, `server/runner/pyframe.mjs`)

On the first Python run the page creates a hidden iframe with `sandbox="allow-scripts"` and no `allow-same-origin`
(an opaque origin: no access to Dojo's IndexedDB, `localStorage` or `/db`). Its CSP (`frameCsp`) allows scripts and
connections only to `/pyodide/` and `/pyrunner/` (plus `blob:` and `'wasm-unsafe-eval'`, never `'unsafe-eval'`). Its
worker loads Pyodide and the harness (`dojo_harness.py`, `dojo_tk.py`), then removes `fetch`, `XMLHttpRequest`,
WebSockets, `importScripts`, IndexedDB, caches, `BroadcastChannel`, nested workers and its own `postMessage` before
learner code runs. The frame terminates the worker after 3 s; the page gives up after 7 s, and validates every
message from that frame.

**Toolkit.** Go (`import "dojo/tk"`) and Python (`from dojo import tk`) share one API and event format: `Table` with
`Set`, `Dep` and `Rule`; `Enter`, `Hit`, `Exit`, `Link`; and `Grid`, `Graph`, `Heap`, `Queue`, `DSU`,
`Array`/`Chars`, `Search`, `List`, `Intervals`, `Tree`, `GameTable`. `shared/stepShape.mjs` defines the steps both
runners produce; `src/runner/DpView.tsx` and `src/runner/families/` render them.

## Vendored assets

- **Pyodide** (npm `pyodide`, pinned): the Vite plugin `scripts/vendor-pyodide.mjs` copies the runtime and
  `scripts/licenses/pyodide/LICENSE` into `dist/pyodide/` on build and serves them from `node_modules` in dev. No CDN.
- **Engines** (`public/engines/*.js`), **three.js** (`public/engines/vendor/three/`, with `LICENSE` and `VERSION`;
  `pom-stage.js` loads this copy) and **fonts** (`public/fonts/`, with OFL texts) are committed.
- **Bank packs.** No third-party problem list ships. `src/content/banks/` holds the pattern tables, and `packs.ts`, the
  empty default for the `@bank-packs` alias (`vite.config.ts` `bankPacksPath`): `PACK_META` (extra tabs), `PACK_KNOWN_ORDER`,
  `PACK_DESIGN_OVERLAP` and `loadPacks()`. The unit and e2e suites alias it to the original fixture packs in
  `tests/fixtures/banks/`; a private build can set `DOJO_BANK_PACKS` to its own module of the same shape. Stored
  `bankItems` rows of any bank id are kept either way. `server/gen/ai-shared.mjs` is generated by `npm run helper:gen`.
  Licences: `THIRD-PARTY-NOTICES.md` at the root; the app bundle also carries Electron's `LICENSE.electron.txt` and
  `LICENSES.chromium.html` in `Contents/Resources`.

## Tests

| Layer | Runner | What it covers |
|---|---|---|
| Unit (`tests/unit`, about 250 files) | Vitest, jsdom, `fake-indexeddb` (`npm test`) | Rules, actions, sync, server modules (store, backups, restore, runner, helper, link check, profile), the install script, React components. |
| End-to-end (`tests/e2e`) | Playwright, Chromium (`npm run e2e`) | `chromium`: specs against `npm run dev` with `DOJO_DEV_DISK=off` (Dexie only, fake AI). `storage`: the production build (built once by `storage/global-setup.ts`) on `dojo-server` with temporary data folders: disk sync, backups and restore, both runners, briefs. `real`: a subset (`real/subset.ts`) re-run with disk sync on. One worker, no retries. |
| Desktop (`tests/desktop`) | Playwright's Electron driver (`npm run e2e:desktop`) | Builds `Dojo.app` once into a temp folder and launches it on temporary data folders with a bare GUI PATH and the fake AI: single instance, the writer window, Go and Python runs, AI through the app's server, the shipped licences. |
| Parity (`tests/parity`) | Playwright (`npm run parity:*`) | Screenshot comparison with the design prototypes (see Known gaps). |

`npm test` and the Playwright configs pin a non-UTC time zone and many tests use fixed clocks, so date boundaries
behave the same everywhere. No test calls the real `claude`, and `tests/e2e/guard.ts` refuses a server whose
database is the real `~/Dojo`. Test-only variables: `DOJO_STORAGE_PORT` (default `DOJO_PORT + 100`),
`DOJO_REAL_PORT` (`DOJO_PORT + 102`), `DOJO_E2E_DIST` (reuse a prebuilt dist), `DOJO_PARITY_PORT`, `UPDATE_PARITY=1`.

## Environment variables and flags

| Variable | Default | Meaning |
|---|---|---|
| `DOJO_HOME` | app: `~/Dojo`; server: required | The data folder. Non-app runs refuse `~/Dojo`. |
| `DOJO_PORT` | app: free port; dev: 8790 | Server port (required for `npm run server`), or the Vite dev port. 8787 is reserved. |
| `DOJO_SERVER_PORT`, `DOJO_DEV_DISK` | 8789, on | `npm run dev`: the dojo-server port behind Vite; `off` runs Vite alone on Dexie. |
| `DOJO_DB_EXTRA_ORIGINS`, `DOJO_HELPER_ORIGINS` | none | Extra origins for `/db` and `/tools`, and for the AI routes (comma-separated). |
| `DOJO_HELPER_PORT`, `DOJO_HELPER_TIMEOUT_MS`, `DOJO_HELPER_CONCURRENCY` | 8788, 90000, 2 | The standalone helper's port; one job's deadline; jobs at once. |
| `DOJO_CLAUDE_BIN`, `DOJO_GO_BIN` | `claude`, none | Name or path of the Claude Code CLI; of `go` (when set, only it is used). |
| `DOJO_PROJECT_REPO` | none | The grader's local repo. Wins over `projectRepo` in `profile.json`. |
| `DOJO_DESKTOP_FAKE_AI`, `DOJO_DESKTOP_INFO`, `DOJO_REAL_SMOKE` | none | Tests: `1` runs the app's server with the fake AI; a file the app writes its URL, pid and home to; `1` allows `smoke:real`'s one real call. |
| `VITE_DOJO_AI`, `VITE_DOJO_HELPER_URL`, `VITE_DOJO_AI_PORT`, `VITE_DOJO_DISK` | fake, none, 8788, on | Build time: `helper` sends jobs to a helper instead of the in-page fake, at that base URL (`self` = the page's origin) or port; `off` builds a Dexie-only app. |

Server flags: `--real` (the app only; allows `~/Dojo`), `--fake`, `--dist <dir>`, `--parent-pid <pid>`,
`--linkcheck-allow-loopback` (e2e only). The helper also takes `--no-retry` (the smoke test).

## Known gaps

- The parity suite (`tests/parity`, `playwright.parity.config.ts`) and a few unit tests (those using `legacyPlan()` in
  `tests/helpers/plan.ts`, and the `ai-guardrails`, `ai-validate`, `ai-types`, `engines` and `diagram-kit` tests)
  read fixtures and design prototypes outside the repository root that are not in this repository. They fail here until those
  fixtures move into `tests/fixtures/` or the tests are dropped.
- `npm run engines` regenerates `public/engines` from design sources that are not in this repository; treat the
  committed engine files as the source.
- `sprint_days` and `total_sprints` in `plan.json` are not read; sprint length (14 days) and count (72) are constants.
- `npm run build` alone makes a build with the in-page fake AI; only `install:app` (or `VITE_DOJO_AI=helper`) wires
  the real helper. `npm run desktop` opens `~/Dojo` unless `DOJO_HOME` is set.
- macOS only: the Go runner needs `sandbox-exec`, and the installer `codesign`, `sips` and `iconutil`. The app is
  signed ad hoc, not notarized.
