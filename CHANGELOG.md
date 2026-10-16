# Changelog

All notable changes to Dojo. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses [Semantic Versioning](https://semver.org/).

## 2.1.0 - 2026-10-16

Release 2: labs you can run, check and have reviewed, the Proven state, rituals, and the Portfolio. A minor version: Dexie moves
to v12 on first launch (after a server backup) and drops tables for the retired brief, check and deliverable features.

### Added

- **Labs:** the lab engine (`/labs/*` routes, Set up lab, Run checks, hints, the review bundle), the `lab_review` AI job,
  Dexie v11 and `npm run lab:verify`. The design session's rubric constants moved to `src/ai/rubric.ts` (smaller entry chunk).
- **Lab loop on a build ticket:** Set up lab, Run checks with per-check results, a Done gate that opens when the ticket's
  checks pass ("Mark done without checks" stays available), the three-rung hint ladder, and the AI review in the lab block
  of every ticket of the lab. Build tickets also show their links and Explain-it-simply questions.
- **Topic states on AI nodes:** Learning, Learned, Built and Proven badges on the skill map and a next-step line in the node panel.
- **L1 lab pack and rituals data:** six Phase-1 labs (b1-tokensim, u1, l5-memsum, g1-log, r1-local, r1-vllm) with templates, references and checks, ticket-level explain content on the watch/read tickets, and ritual `dueHour`, `body` and monthly `dueWeekday` fields in the plan.
- **Lab drop checks:** an unknown lab answers `GET /labs/info` with HTTP 200 and `ok: false` (the ticket shows the missing state with no console error), a lab run is stamped with the app clock of the click, and `plan:check` now fails when a build ticket's lab has no folder.
- **Rituals:** the Floor (a 15-minute session of up to five cards and one line, a quiet welcome back after four or more days
  away, and half-size budgets for the next four days), the Journal Week view with the weekly review, the monthly model swap
  drill card, and passed explain checks that schedule review cards (at most ten shown per day). No streaks, no overdue counts.
- **Portfolio:** a new destination (13th, no number key) that turns a Proven lab into a public repo folder, a portfolio site page, an
  article draft and a LinkedIn draft. Each output is a draft first; a confirm screen lists every file and the exact URL, the leak scan
  (home paths, emails, tokens, personal terms) blocks the publish with no override, and nothing is pushed (never forced) without your click.
  New `/portfolio/export` and `/portfolio/publish` routes, the `portfolio_draft` AI job and the `portfolioItems` table.

### Changed

- Cleanup: the brief editor, check dialog and gate, deliverables and capstone stages are removed; Dexie v12 drops the `artifacts`, `stageCells` and `blankTests` tables after a backup; the installer now defaults to `/Applications`.

### Fixed

Found in the R2 acceptance runs (UAT A and UAT B) and the blind contract walk:

- **Labs:** a lab review with more than three evidence entries on one item is no longer refused, and a malformed evidence entry
  is dropped instead of refusing the whole review; a check row's status word is a word of its own; an unknown lab answers
  `GET /labs/info` with HTTP 200 and `ok: false`; the `b1-tokensim` time-to-first-token window is 105 to 135 ms.
- **Lab references:** the `b1-tokensim` reference sweep now has a warm-up, seeded repeats and error bars; the `u1` reference tests cover the full retry rules; the `r1-vllm` reference is pinned to vLLM 0.31.0.
- **Today and rituals:** a started ticket on a restart day keeps the Floor lead; a started weekly review or model swap drill
  ticket is never the quest or in the pick list; on a phone the Floor card's START sits above the fold with a focus line, and
  the scroll padding clears the tab bar.
- **Portfolio:** repo drafts make no `gh` call, the empty and not-set-up states are one sentence each, and the leak scan has a
  rule for private host names and IP addresses.
- **Layout:** a board card title breaks between words (inside a word only when wider than the card); the Journal week heading
  keeps each date on one line on a phone; on a Floor day "No study today" sits below the fields; an opened phone Skills row is
  brought up clear of the next-ticket panel; a stored lab review wraps inside the ticket column; topic badges on map nodes no
  longer clip titles; the rail toggle survives a quick reload; `/` focuses an already drawn search box on Path.
- **Server and install:** an unreadable backups folder lists as empty, so `/db/health` still answers and the page starts; a
  refused start with a not-yet-existing `DOJO_HOME` never creates a directory.

## 2.0.0 - 2026-10-14

Release 1 of the replan: Dojo is rebuilt around one flat queue of single-sitting tickets. This is a major version because
your data is converted on first launch and the screens and keys changed. Back up `~/Dojo` first; see "Upgrading from 1.x"
in the README.

### Changed

- **A flat queue replaces sprints.** The 72-sprint calendar, the weekly rotation, containers with child parts, unlock
  gating and the sprint tools (Slide sprint, Shift plan, the load check) are gone. Tickets sit in lanes (AI, DSA,
  Design and an optional Career lane); your weekly minutes (default 480 a week, set per weekday in Settings) set the pace
  and the projected finish month. Nothing is trimmed or marked late.
- **Six places in the rail, keys `1` to `6`:** Today, Path, Board, Journal, Skills, Review. Under them, Topics (AI, DSA,
  Designs), Practice (Banks, Atlas) and the Guide, with a rail that collapses to icons. The Week, Overview, Mentors,
  Ritual, Map, Progress and AI capstone screens are retired; their links land on Today, the Guide or Skills.
- **Today** shows one ticket and why it is next, a "waits for a longer day" rule for long tickets, the daily AI pulse and
  the weekly try-a-model ritual.
- **Pom is back on Today:** a voxel companion in nine forms (BASE to SOVEREIGN) that follows your level, with a bar to the
  next form. A form is never taken back. Settings has a Debug · Pom panel to preview any form; it changes nothing.
- **AI areas open as a tree:** each AI area is laid out in rows by what its topics build on, the same way as DSA and Design.
- **A new sample plan:** an AI-infrastructure plan (ten areas; Phase 1 of six fully written as 51 tickets, phases 2 to 6 as
  outlines) with the DSA bank (17 topics, 170 problems) and the design bank (48 designs) as lanes of the same queue.
- **Design sessions v2:** the AI partner is a thinking coach that asks one question at a time and never gives the answer;
  a Hint button asks a sharper question; structured notes (requirements, API, data model with schema tables, trade-offs);
  a partner card for playing the partner with a friend in a second window; canvas notes, boxes, tables and frames.
- **Review is answer first:** write your answer, reveal the stored one and mark yourself.

### Added

- **Board:** a two-week sprint of your queue as To do, Backlog, Doing, Blocked, Need help and Done columns.
- **Journal:** a two-minute daily entry (how hard each ticket was, whether you could explain it without notes), a "came up
  hard" list with Add to Review, and a no-study-today button that carries no penalty.
- **Skills:** AI areas as a map, DSA and Design as trees of topics in rows by prerequisite, a Stats tab, and a topic panel
  that starts the next ticket.
- **AI topics** page, and **Banks** with Design and AI question banks (about 490 questions) beside the DSA bank and Mine.
- Explain-it-simply questions with reference answers on watch, read and build tickets, answered before Done; learner notes
  and self-marks stored in your data.
- A one-page in-app **Guide**.

### Data

- First launch converts a 1.x database once, after taking a snapshot: XP, sessions, attempt logs, redos and design sessions
  are kept; cards the new plan does not contain are archived and keep their XP; old interviewer-mode design sessions open
  as AI-partner sessions. Restoring an old backup converts it again.
- A model-version gate makes an older window read-only against newer data. Builds before 2.0 have no such gate, so install
  2.0 before opening your data anywhere else.

## 1.0.0 - 2026-10-07

The first public release. Summarised from the development history (September to October 2026).

### The app

- A Mac app built with Electron 44: one window, one instance, the Dojo server running inside the app on Electron's
  own Node on a free `127.0.0.1` port, Help menu entries for the data and logs folders. `npm run install:app` builds
  and installs `~/Applications/Dojo.app` (ad-hoc signed) and `npm run uninstall:app` removes it; neither touches the
  data. It replaces an earlier launcher that opened Dojo in a Chrome window.
- First-launch onboarding that sets the plan start date; a sample 72-sprint plan with an AI track, an interview
  track, a DSA bank, a design bank and a skill tree.
- Fourteen tabs with keyboard shortcuts (`1` to `9`, `0`, `a`, `b`, `m` for More): Today, Board, DSA, Designs, AI,
  Map, Progress, Week, Overview, Atlas, Banks, Mentors, Ritual and Settings. A phone-width layout (Today, Board, DSA and
  More in the nav) with 44 px touch targets.

### Planning and daily work

- **Today:** the NOW tile with the day's role and a Start button, vitals (sprint clock, consistency calendar,
  badges), dig-in drawers for this sprint, cards left behind, DSA and design days, a Redo drawer and a load check.
- **Board:** sprint strip, Kanban with drag and keyboard moves, a Doing cap, Slide sprint, Shift plan and 20-deep
  Undo.
- **Workload:** core minutes per sprint, day types, suggestions that fit today, automatic roll-over of unfinished
  cards, Rebalance, Pin and Move to sprint.
- **Do:** a focused screen with a session timer, focus and break blocks with a chime, attempt log, a help ladder with
  honest outcomes, give-up and redo sessions, and a study session that keeps running across screens.
- **Card briefs and learning checks:** AI-drafted briefs you edit and approve, splitting big items into sessions,
  "Check your understanding" with code-graded multiple choice and AI-graded open answers, a redo three days out on a
  failed check, and deliverables for build cards.
- **Sprint reviews:** numbers computed in the app, prose written by the AI.

### Practice

- **Go runner:** write a Go function on Do, Run the examples or Submit all cases. Builds offline and runs under
  macOS `sandbox-exec` (no network, no writes outside a temp folder, time, output and memory limits). 20 problem
  packs.
- **Python runner:** the same problems in Python through Pyodide 0.29.5, bundled into the app and run in a sandboxed
  frame; a Go | Python switch in the code panel.
- **Step-by-step views:** the `dojo/tk` toolkit (Go and Python) records DP tables, call trees and data-structure
  families (heap, queue, union-find, graph, arrays, lists, trees, intervals and more) for a scrubbable trace.
- **Atlas:** 36 algorithm patterns with 45 walkthroughs in a lab player (predict, own input, snapshot as PNG).
- **Banks:** the Plan bank and your own "Mine" bank (paste a problem link or name), with search, filters and shared
  ticking. No third-party problem lists are bundled; a Codeforces ladder can be imported into a bank pack.
- **Design sessions:** a 45-minute timed session on a drawing canvas, an AI interviewer, a five-question close,
  scoring, a reference diagram and diff, and PNG export. The Designs tab shows tiers, a lens radar and redesigns due.

### AI (optional, through your Claude Code login)

- Jobs for hints, pictures, diagrams, interviews, grading, solutions, slide suggestions, classification, briefs,
  learning checks and sprint reviews. Each runs `claude -p` with the user's own login; outputs are validated, with
  guardrails such as no full solution before you give up. No API key is ever stored.
- Without Claude Code every AI panel says "Claude Code is not installed or not on PATH." and the rest of Dojo works.
- An optional local project repo for grading (`projectRepo` in `profile.json` or `DOJO_PROJECT_REPO`), read
  read-only.

### Data and safety

- SQLite (`node:sqlite`) in `~/Dojo/dojo.db` as the source of truth, with a working copy in the window (Dexie) that
  syncs through an outbox, a save-status indicator, and a keepalive flush when the window hides.
- Daily and manual backups, a confirmed restore that keeps a pre-restore copy, a Rejected changes list, and
  `npm run db:export-pg` for a Postgres SQL dump.
- A writer token: only the app window can write. The server answers only its own origin on loopback.
- A link check on briefs that accepts only public http(s) addresses (no private, loopback or link-local targets, no
  redirects, size and time limits).
- `~/Dojo/profile.json` for your own schedule, learner links and project repo, so the shipped code carries no
  personal values.

### Release preparation

- Fonts (Chivo, Silkscreen, Space Mono) self-hosted with their OFL texts; nothing is loaded from Google.
- Pyodide's MPL-2.0 licence ships in the build; THIRD-PARTY-NOTICES.md covers every bundled component.
- Electron's and Chromium's licences are copied into `Dojo.app/Contents/Resources/`.
