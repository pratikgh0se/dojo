# Changelog

All notable changes to Dojo. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses [Semantic Versioning](https://semver.org/).

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
