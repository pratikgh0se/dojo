<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/banner-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/banner-light.svg">
    <img alt="Dojo: a local-first Mac app for finishing a long study plan" src="docs/assets/banner-light.svg" width="900">
  </picture>
</p>

<p align="center">
  <strong>One ticket for today, a queue you can reorder, a board and a journal, code that runs and is graded on your machine, system-design practice and honest progress, for a study plan that lasts months.</strong>
</p>

<p align="center">
  <a href="LICENSE"><img alt="MIT licence" src="https://img.shields.io/badge/licence-MIT-3ddc84?style=flat-square&labelColor=0f111c"></a>
  <img alt="macOS 13 or later" src="https://img.shields.io/badge/macOS-13%2B-3ab4ff?style=flat-square&labelColor=0f111c">
  <img alt="Apple silicon" src="https://img.shields.io/badge/Apple%20silicon-tested-ff8a2a?style=flat-square&labelColor=0f111c">
  <img alt="Node 22.13 or later to build" src="https://img.shields.io/badge/Node-22.13%2B%20to%20build-c084fc?style=flat-square&labelColor=0f111c">
  <img alt="Local-first: no account, no cloud, no telemetry" src="https://img.shields.io/badge/local--first-no%20cloud-ffb545?style=flat-square&labelColor=0f111c">
</p>

<p align="center">
  <img src="docs/assets/tour.gif" alt="A short tour of Dojo" width="760">
</p>

Dojo takes a study plan that runs for months and turns it into a daily habit you can see. Open it and **Today**
shows the one ticket that is next, and why. Press Start and you are working on it, with a timer, a place to write
what you tried and a code panel that runs your solution. Anything you do not finish simply stays next: nothing is
marked late. A two-minute **Journal** closes the day, and **Review** brings back what is due for another try.

Your data is one SQLite file in a folder on your Mac. There is no account, no cloud and no telemetry. The AI help is
optional and goes through your own [Claude Code](https://docs.claude.com/en/docs/claude-code) login.

**Jump to:** [Why](#why-dojo-exists) · [A day in Dojo](#a-day-in-dojo) · [Features](#what-it-does) ·
[Is and isn't](#what-dojo-is-and-isnt) · [Quick start](#quick-start) · [Upgrading from 1.x](#upgrading-from-1x) ·
[Your own plan](#bring-your-own-plan) · [Privacy](#privacy-and-your-data) · [FAQ](#faq) · [Roadmap](#roadmap)

## Why Dojo exists

I built Dojo for myself. I am a working engineer, and I study on evenings and weekends. My plan was long: months of
systems, data structures and algorithms, and AI engineering, cut into tickets small enough for one sitting. A plan like that does not
fail on day one. It fails around week six, when you cannot tell what you were meant to do today, which cards you
dropped, or whether you are really on pace.

I tried the usual tools.

- **A spreadsheet** held the plan, but it could not tell me what to do today. It also could not keep an order for the cards I
  skipped.
- **Notion** was good for notes. A board is not a plan, though, and nothing in it timed a session or counted a
  redo.
- **LeetCode in a browser tab** let me solve problems, but it knew nothing about my plan. It could not tell me I was
  leaning on hints.
- **Flashcards** are fine for facts. They are a poor fit for "rebuild this from a blank file" or "design this in 45
  minutes".

So I ended up with ten tabs and a lot of guilt. What I wanted was one place that knew the whole plan, showed
today's work, and let me do the work without leaving. It should also be honest about progress: how much help I used,
what I gave up on, and what is due for another try.

Dojo is that place. It is a tool for one person with a long plan. It is not a course, and it does not teach you the
material. It gives your plan structure and keeps you doing it.

## A day in Dojo

Six places in the rail cover most days (keys `1` to `6`), and the work itself opens in its own screen. Below the six, the
rail has **Topics** (AI, DSA, Designs) and **Practice** (Banks, Atlas). The screenshots show the shipped sample plan on
a made-up study history, not anyone's real data.

### <img src="docs/assets/icon-today.svg" width="28" align="center" alt=""> 1. Today: what do I do now?

<img src="docs/screenshots/readme-today-1280.png" alt="Dojo's Today screen: the next ticket and why it is next, a daily AI pulse, a weekly try-a-model ritual and a count of reviews due" width="820">

Open Dojo and the first screen answers that question with one **ticket card**: the next ticket, the reason it is next
("you started this one", "reviews are piling up", "next in your queue", "waits for a longer day") and one orange
**Start** button (Enter works too). If the ticket does not suit your time, **Pick something else** lists a few others,
and picking one changes nothing until you start it. A badge points to Review when cards are due. Beside it sit the
small rituals: a 15-minute daily AI pulse and a weekly try-a-model run; both are optional and simply close if you skip them.
Your weekly minutes set the pace, not a calendar, so there is nothing to fall behind on. A collapsed drawer holds
your stats.

Above the rituals sits **Pom**, a small voxel companion that grows with your level through nine forms, from BASE to
SOVEREIGN. It shows how far to the next form and never goes back to an earlier one. It is
decoration only: nothing to click, nothing you can lose.

### <img src="docs/assets/icon-board.svg" width="28" align="center" alt=""> 2. Path: the whole queue

<img src="docs/screenshots/readme-path-1280.png" alt="Dojo's Path screen: lane chips, a search box and the queue of tickets in order" width="820">

Every ticket in the order you will do them, in three groups: **Doing**, **Up next** and **Done**. Lane chips (AI, DSA,
Design, and Career if you switch it on in Settings) and a search box narrow the list. Drag a ticket to reorder it within
its lane, or into Doing. Start any ticket from here.

### 3. Board: this sprint in columns

<img src="docs/screenshots/readme-board-1280.png" alt="Dojo's Board screen: a two-week sprint laid out as To do, Backlog, Doing, Blocked, Need help and Done columns" width="820">

The Board lays out a two-week sprint of your minutes as columns: **To do** (what fits in the minutes you have),
**Backlog** (the rest of the queue), **Doing**, **Blocked**, **Need help** and **Done**. Drag a card or use its menu.
Blocked is for a ticket something outside you is holding up, and Need help is for one where you want a person to look
at it. You set both yourself, with a short reason, and the queue carries on without them.

### 4. Journal: how did the day go?

<img src="docs/screenshots/readme-journal-1280.png" alt="Dojo's Journal screen: a week strip, today's tickets each rated for how hard it was and whether you could explain it without notes, and a list of what came up hard this week" width="820">

A two-minute entry near the end of a study day. For each ticket you worked on, say how hard it was (Again, Hard, Good,
Easy) and whether you could explain it without notes (No, Partly, Yes). A day with no study is one button, and a
missing day is never counted against you. **Came up hard this week** collects tickets that kept getting rough marks, and
**Add to Review** sends one back for another try.

### <img src="docs/assets/icon-progress.svg" width="28" align="center" alt=""> 5. Skills: what am I learning?

<img src="docs/screenshots/readme-skills-1280.png" alt="Dojo's Skills screen on the AI tab: ten areas as a map, each with its progress and what it needs first" width="820">

The map of the plan, in tabs: **AI** (ten areas, from how LLMs run to GPU fleets and safe rollout), **DSA** and
**Design**, each a tree of topics, and **Stats** for how much you have done and your pace. Pick an area or a topic to see
what it builds on, its tickets and the next one in it, and start that ticket from the panel.

<img src="docs/screenshots/readme-skills-area-1280.png" alt="An AI area opened as a map: topics laid out in rows by what they build on, with arrows for prerequisites and the next topics highlighted" width="820">

An AI area opens the same way, as a tree: each topic sits in a row below the topics it needs, so you can see what is
unlocked and what is next at a glance.

<img src="docs/screenshots/readme-skills-dsa-1280.png" alt="Dojo's DSA skill tree: topics in rows by what they build on, with the next topic highlighted" width="820">

### 6. Review: what has come back?

<img src="docs/screenshots/readme-review-1280.png" alt="Dojo's Review screen: one card with a question, a box to write your answer first and a Reveal button, beside the queue of cards due" width="820">

Items that are due again, one card at a time, **answer first**: write your answer, then reveal the stored one and mark
yourself. Learning checks come back as questions; problems and designs come back as a replay of the ticket. A redo three
days after you gave up passes only if you solve it again with at most a hint, then it returns at ten days and thirty.
**Skip for today** sends a card to the back of the queue without writing anything.

### <img src="docs/assets/icon-do.svg" width="28" align="center" alt=""> The Do screen: the work itself

<img src="docs/screenshots/readme-do-go-1280.png" alt="Dojo's Do screen for a practice problem: statement, timer, attempt log, Go code panel with test cases, and a step-by-step trace of a dynamic-programming table" width="820">

This is the focused screen: a timer, an attempt log ("What is the invariant? What did you try?") and, for problems,
a code panel. Write Go or Python, press **Run** for the examples or **Submit** for every case. Both run on your
Mac. **Solved** stays locked until a Submit passes all the cases. Watch, read and build tickets end with a short
"explain it simply" check that you answer before Done.

If you get stuck, there is a **help ladder**: attempt, hint, picture, video, solution. Each rung costs XP, and the
solution only opens after you give up. Giving up, or solving with deep help, schedules a **redo** three days later,
then ten, then thirty. A redo only passes if you solve it again with at most a hint. The help you used is on the
record, so your progress numbers stay honest.

If you use Dojo's small `tk` toolkit in your code, the **Trace** panel replays the run step by step. It shows a
DP table with its dependency arrows, a call tree, or a graph, heap or queue. Seeing why `dp[3] = dp[2] + dp[1]` is
worth more than reading it.

<details>
<summary><strong>The picture player (Atlas walkthroughs)</strong></summary>

The Atlas maps algorithm patterns. Each pattern has walkthroughs you can play, but you can also **predict** the next
step first, run your **own input**, compare two walkthroughs side by side, and save a snapshot as a PNG.

<img src="docs/screenshots/readme-picture-1280.png" alt="Dojo's Atlas with a topological-sort walkthrough open in the picture player, with predict, own input and snapshot controls" width="820">

</details>

### <img src="docs/assets/icon-designs.svg" width="28" align="center" alt=""> Designs: practise system design against a clock

<img src="docs/screenshots/readme-designs-1280.png" alt="Dojo's Designs screen: designs per tier, a lens radar, the deep-dive wall and a shelf of your own diagrams" width="820">

Pick a design from the tiered bank and start a 45-minute session. Draw your architecture on the canvas and write
requirements, an API, a data model and trade-offs in the notes, solo or with an AI partner. The partner works as a
**thinking coach**: it opens with the prompt and one question, then asks one question at a time and never hands you the
answer or a list of options. Or play it with a friend: a partner card opens in a second window with the follow-up
questions and a scoring sheet. Then answer five closing questions and score yourself on a 20-point rubric and seven
lenses: load, data, consistency, failure, latency, cost and evolution. At the end you see your diagram next to a
reference diagram, with the differences listed. It is information, not a grade. A weak design comes back for a redesign
30 days later.

### Banks, AI topics and the rest

<img src="docs/screenshots/readme-banks-1280.png" alt="Dojo's Banks screen on the DSA tab: the plan's problem bank by topic with tick boxes, difficulty and pattern tags" width="820">

**Banks** holds three tabs. **DSA** is the plan's own problem list, by topic, plus **Mine**, a list you build by pasting a
LeetCode or Codeforces link. **Design** and **AI** hold question banks (about 490 questions across the sample plan),
answer first like Review: write your answer, reveal, then add any question to Review to see it again later.
**AI topics** (in the rail under Topics) lists every AI topic with its tickets and hours. **DSA** and **Designs** open
the problem bank and the design tiers, **Atlas** maps patterns to pictures and problems, and **Guide** is a one-page
"how Dojo works". Press **Ctrl or Cmd K** to jump to any ticket, skill, screen or setting. **Settings** is the gear at
the top right.

## What it does

<table>
<tr>
<td valign="top" width="50%">

**Plan and schedule**
- A flat queue of single-sitting tickets in lanes (AI, DSA, Design and an optional Career lane)
- **Today** picks the one next ticket by fixed rules; weekday minutes set your pace, not a calendar
- **Path** shows the whole queue (Doing, Up next, Done) and lets you reorder it
- **Board**: a two-week sprint as columns, with Blocked and Need help you set yourself
- **Journal**: a two-minute daily entry on how hard each ticket was
- **Skills**: ten AI areas plus DSA and Design trees, with prerequisites shown and a Stats tab
- Nothing is trimmed or marked late: an unfinished ticket just stays next

**Do the work**
- One timer, study sessions with focus and break blocks and an optional chime, and focus mode
- An attempt log for every card
- A help ladder that costs XP, and redos on a 3, 10 and 30 day schedule
- **Briefs** for cards (a goal, steps, minutes, a deliverable) and an answer-first check before a watch, read or build ticket counts as done

</td>
<td valign="top" width="50%">

**Practise**
- Go and Python runners with a Run and Submit loop, 20 problems with ready-made test packs
- Step-by-step traces of your own code (DP tables, call trees, graphs, heaps, queues and more)
- Atlas: 36 algorithm patterns with walkthroughs you can play, predict and run on your own input
- **Banks**: the plan's DSA list, your own list ("Mine"), and answer-first question banks for Design and AI
- A design bank of 48 designs in tiers, timed sessions, a thinking-coach AI partner or a human partner card, and PNG export

**See progress**
- XP, levels and forms, with a cost for help so numbers stay honest
- A **Stats** tab under Skills, and a pace line in Settings that moves as you change your weekday minutes
- **Review**: the redo and replay queue, answer first, with a badge for what is due
- Markdown export of the measures you collect on builds

</td>
</tr>
</table>

<details>
<summary><strong>Optional AI features (all through your own Claude Code login)</strong></summary>

Hints (two levels), picture walkthroughs, architecture diagrams, solutions after you give up, the design
partner and its grade, grading of what you hand in, classifying a problem you add, drafting briefs and
learning checks. Outputs are validated, and guardrails keep, for example, the
full solution behind **Give up**. For build cards in the AI track the AI never writes your code.

Everything not on that list works without Claude Code.

</details>

<details>
<summary><strong>Keyboard-first</strong></summary>

`1` to `6` jump between Today, Path, Board, Journal, Skills and Review. Ctrl or Cmd K opens search, which also reaches
DSA, Designs, Atlas and Banks, and `?` lists the shortcuts. On Today, Enter starts the ticket. The keys do nothing while
you type. The [user guide](USER-GUIDE.md#keyboard-shortcuts) has the full list.

</details>

## What Dojo is and isn't

| Dojo is | Dojo is not |
|---|---|
| A Mac app for **macOS 13 or later**. Tested on **Apple silicon only**. | A Windows, Linux or Intel Mac app. Those are not supported or tested. |
| **Single user, one machine.** One data folder, one window. | A synced or shared app. There is no sync between devices and no team mode. |
| **Local.** Data in `~/Dojo`, a server inside the app on `127.0.0.1`. | A cloud service. There is no account, no sign-in and no telemetry. |
| **Built on your Mac** by `npm run install:app`, then signed ad hoc. | A signed, notarized download. There is no installer to download yet. macOS may ask you to approve it once. |
| A place to **do** practice: run Go and Python, trace it, redo it. | A course. It does not teach you the material or host lessons. |
| **Optional AI** through your own `claude` CLI login. | An AI product. No API key, no account of its own. Without Claude Code, AI panels say so and the rest works. |
| Shipped with a **generic sample plan** you can replace. | Tied to the sample. Bring your own plan (see below). |
| Honest about **problem lists**: see the note below. | A bundle of NeetCode, Blind 75, Striver or similar lists. None ship. |

**About problem lists.** Dojo does not bundle third-party problem collections, and it does not carry full problem
statements: each card links to the original page. The sample plan's DSA bank is the plan's own list: problem numbers and names with links back to LeetCode.
Of those, 20 have local test packs (a signature, a short starter and test cases) so you can Run and Submit in Dojo; for the rest you work on the original site and tick the card.
To add problems of your own, open **Banks > Mine**, paste a LeetCode or Codeforces link or type a name, press
**Classify** (this uses the optional AI), and accept. It becomes a card with its own XP.

**Needs the network?** Not to run. Links you open go through your browser, a brief's optional **Check links** makes
requests to those links, and AI features send their prompts via the `claude` CLI.

## Quick start

You need an Apple silicon Mac on macOS 13 or later, `git`, and Node.js 22.13 or later with npm. Go (1.22 or later)
is optional and only needed for the Go runner. Claude Code is optional and only needed for AI features.
Python needs nothing: its runtime is bundled.

Clone the repository:

```bash
git clone https://github.com/pratikgh0se/dojo.git
cd dojo
```

Install the packages:

```bash
npm ci
```

Build the app and install it. The first run also downloads the Electron runtime (several hundred MB on disk; `npm ci`
does not fetch it). It installs to `/Applications` (you need write access there, as an admin account has):

```bash
npm run install:app
```

To put it somewhere else, for example `~/Applications` (no special rights needed), pass `--dest ~/Applications`.

Open it:

```bash
open /Applications/Dojo.app
```

Re-running `npm run install:app` after a `git pull` updates the app and never touches your data. If you move to a
different folder, delete the old `Dojo.app` so two copies do not share one data folder.

If macOS refuses to open the app the first time, see
[Troubleshooting](TROUBLESHOOTING.md#macos-says-dojo-cannot-be-opened). In short, right-click it in Finder, choose
**Open**, and confirm.

### What you will see on first launch

1. Dojo creates `~/Dojo` and opens a single window. (If you already have a `~/Dojo` from Dojo 1.x, see
   [Upgrading from 1.x](#upgrading-from-1x) first.)
2. **Pick your start date.** It defaults to a Monday: today if it is a Monday, the Monday just gone on a Tuesday or Wednesday (you start mid-week 1), otherwise the next Monday. Your plan begins that day at local midnight, and you
   can change the date later in Settings.
3. Dojo loads the sample plan and opens on **Today**. Press **Start** on the ticket card, or open **Path** (key `2`) to
   see the whole queue.

That is all the setup there is. Work through the [user guide](USER-GUIDE.md) when you want the details.

<details>
<summary><strong>Want to look around without installing the app?</strong></summary>

A development mode runs the same interface in a browser tab, with a built-in fake AI and a scratch data folder. It
never touches `~/Dojo`:

```bash
npm run dev
```

Then open http://127.0.0.1:8790. This is meant for contributors, so nothing is saved to your real data and the AI
answers are canned. See [CONTRIBUTING.md](CONTRIBUTING.md).

</details>

<details>
<summary><strong>Install options and removing the app</strong></summary>

Pass options after `--`, for example `npm run install:app -- --dest ~/Desktop`.

| Option | Default | What |
|---|---|---|
| `--dest <dir>` | `/Applications` | Where to put `Dojo.app`. |
| `--home <dir>` | `$DOJO_HOME` or `~/Dojo` | The data folder, baked into that copy of the app. |
| `--no-icon` | | Skip building the Dock icon. |
| `--no-build` | | Reuse an existing web build instead of building one. |

To remove the app (your data stays):

```bash
npm run uninstall:app
```

</details>

<details>
<summary><strong>Prerequisites in detail</strong></summary>

| What | Version | Needed for |
|---|---|---|
| macOS on Apple silicon | 13 Ventura or later | Everything. The Go runner uses macOS's built-in `sandbox-exec`, and the installer uses `sips`, `iconutil` and `codesign`. |
| Node.js with npm | 22.13 or later | Building and installing (the server uses the built-in `node:sqlite`). The installed app runs on Electron's own Node. |
| git | any | Cloning the repo. |
| Go | 1.22 or later | Optional. The Go runner. Without it, Run and Submit say Go is missing and everything else works. |
| Claude Code (`claude`), logged in | a current release | Optional. The AI features. |

Not needed: Chrome, Python, Docker, a database server, or any API key. The app finds `go` and `claude` itself,
because an app opened from the Dock gets no shell `PATH`.

</details>

## Upgrading from 1.x

Version 2.0 replaces the plan model, so read this before you open the new app on data you care about.

1. **Back up first.** Quit Dojo, then copy the whole `~/Dojo` folder somewhere safe (at least `~/Dojo/dojo.db` and
   `~/Dojo/backups`). Dojo also takes its own snapshot just before it converts anything, but a copy of your own is
   cheap.
2. **Install the new app before you open Dojo anywhere else.** Pull, run `npm ci`, then
   `npm run install:app -- --dest /Applications`. Quit any old Dojo window first, and do not open your data in an old
   build or an old browser tab afterwards: an old build does not know the new data layout and could write old-style
   records over it.
3. **Open it.** On first launch Dojo converts your data once, automatically. The 72-sprint calendar and weekly rotation are gone, so
   your cards become one flat queue; cards that the new sample plan does not contain are archived and keep their XP.
   Your XP total, sessions, attempt logs, redos and design sessions are kept, and an old interviewer-mode design session
   opens as an AI-partner session. A short report of what was converted is recorded in your data.
4. **Check Today and Path.** The next ticket comes from the new queue.
5. **To go back,** quit Dojo, reinstall 1.x, and restore your copy of `~/Dojo` (or a snapshot from
   `~/Dojo/backups`; **Settings > Backups > Restore** brings one back).

What changed on screen: the Week, Overview, Mentors, Ritual, Map, Progress and AI capstone screens are retired (a link to
one lands on Today, or on the Guide or Skills where it still fits). Today, Path, a rebuilt Board, a new Journal, Skills and
Review are the six places, and AI topics, DSA, Designs, Banks and the Atlas sit in the rail beneath them. See the
[changelog](CHANGELOG.md) for the full list.

## Bring your own plan

The shipped sample is an AI-infrastructure plan with a DSA bank and a design bank: Phase 1 of six is fully written
(51 tickets), and phases 2 to 6 are outlines that Today says are still being written. It is the file `public/data/plan.json`. It is plain JSON (a plan v2): **areas** and **phases**, the
**nodes** of the skill map, the flat list of **tickets** with their lane and order, a **DSA bank** by topic, a **design
bank** in tiers, the lane **mix** with weekday minute budgets, and a few **rituals**. To use your own:

1. Edit or replace `public/data/plan.json`.
2. Run `npm run install:app` again and reopen Dojo.

On every start Dojo reconciles your cards with the plan. Progress on cards whose id is still there is kept and their
text refreshed. New ids become new cards. Cards whose id left the plan are archived and keep their XP. To rename an id
without losing history, add an `idMap` entry.

A few limits, all documented: every ticket id has to be unique, and an older plan with sprints and a weekly rotation is no
longer read. If the file cannot be used, Dojo shows a **Plan data problem** with the reason and does not load half a plan.

Your day, your study block and your project repo go in an optional `~/Dojo/profile.json`, so you can change them
without editing the plan. Full details: [Your own plan](USER-GUIDE.md#your-own-plan),
[Your profile file](USER-GUIDE.md#your-profile-file) and the
[plan data model](docs/ARCHITECTURE.md#the-plan-data-model).

## Privacy and your data

<img src="docs/assets/icon-privacy.svg" width="48" align="right" alt="">

- **Where it lives.** `~/Dojo` (or the folder you chose at install). **Help > Open Data Folder** opens it.
- **No account, no cloud, no telemetry.** Dojo's server listens only on `127.0.0.1`, on a free port that your network
  cannot reach. There is no sync service to sign in to.
- **What the app requests itself.** The only outbound requests are the optional **Check links** on a brief, which only
  accepts public web addresses. Fonts and the Python runtime ship inside the app.
- **AI is the one exception, and only if you use it.** Dojo runs your own `claude` command with your existing login.
  It stores no key. The text of each request (card text, your notes and answers, and for grading a summary of your
  project repo's recent commits) goes to Anthropic, as in any Claude Code session. The
  [user guide](USER-GUIDE.md#ai-features) lists exactly what is sent.
- **Code you run is sandboxed.** Go runs under the macOS sandbox with no network, no access to your home folder, a
  3-second time limit and a memory limit. Python runs in an isolated frame inside the app.

| Path | What |
|---|---|
| `~/Dojo/dojo.db` | Your progress, in SQLite. The source of truth. |
| `~/Dojo/backups/` | A daily snapshot, plus any you take with **Settings > Backups > Back up now**. The newest 30 of each are kept. |
| `~/Dojo/logs/` | The app's logs. |
| `~/Dojo/profile.json` | Optional. Your own schedule and project repo. |

**Back up.** Dojo snapshots daily. To keep a copy off the machine, copy `~/Dojo/backups` to another disk. Each
snapshot is a complete SQLite database, and **Restore** in Settings brings one back (it saves your current data first).
You can also export everything as Postgres SQL with `npm run db:export-pg`.

**Delete it.** Quit Dojo and delete the `~/Dojo` folder. That removes your data. Copy `~/Dojo/backups` somewhere
first if you might want it back. To remove the app too, run `npm run uninstall:app`. For a full clean-up, macOS may
also keep small files named after the app id `local.dojo.app` (a preferences file and saved window state). Delete
those as well.

**Start fresh.** Rename `~/Dojo` to something else. The next launch creates a new empty folder and asks for a start
date again.

## FAQ

<details>
<summary><strong>Do I need Claude Code or an API key?</strong></summary>

No key, ever. Claude Code is optional. Without it, the AI panels tell you it is not installed and everything else
(Today, Path, runners, traces, design sessions, Review, backups) works. With it, Dojo uses your login.
</details>

<details>
<summary><strong>Is it on the App Store, or is there a download?</strong></summary>

No. You build it on your own Mac with `npm run install:app`. It is signed ad hoc and not notarized, so macOS may ask
you to approve it the first time. [Troubleshooting](TROUBLESHOOTING.md#macos-says-dojo-cannot-be-opened) has the steps.
</details>

<details>
<summary><strong>Does it work on Windows, Linux or an Intel Mac?</strong></summary>

Not today, and these are not tested. The Go runner depends on macOS's sandbox, and the app is a Mac app. I tested on
Apple silicon only.
</details>

<details>
<summary><strong>Does it send my data anywhere?</strong></summary>

Not on its own. There is no account, no sync and no telemetry. The one thing that leaves your Mac is what you choose
to send to Claude through AI features. See [Privacy and your data](#privacy-and-your-data).
</details>

<details>
<summary><strong>Can I use it for something other than DSA, systems and AI?</strong></summary>

The plan is just data, so you can write your own tickets. Some parts are specific to the sample, though:
the DSA and Designs screens, the code runner and the skill tree expect those kinds of content. A plan with empty DSA
and design banks works (those tabs say so), but then you mostly use Today, Path and Review.
</details>

<details>
<summary><strong>Where are the LeetCode and NeetCode lists?</strong></summary>

Not bundled. The sample plan lists its own problems by number and name with links to the original site, and 20 of them
have local test packs. For your own problems, use **Banks > Mine**. See
[About problem lists](#what-dojo-is-and-isnt).
</details>

<details>
<summary><strong>What if my plan changes halfway through?</strong></summary>

Edit `public/data/plan.json` and reinstall. Cards are matched by id, so progress on the ones that remain is kept.
Cards you removed are archived with their XP. Use `idMap` to rename without losing history.
</details>

<details>
<summary><strong>Can I use it on my iPhone, or on two computers?</strong></summary>

Not yet. That is the next planned step: see the [roadmap](#roadmap).
</details>

<details>
<summary><strong>What happens to my data if I update?</strong></summary>

`npm run install:app` replaces only the app bundle. Your data folder is never touched, and Dojo also keeps a daily
snapshot. Moving from 1.x to 2.0 converts your data once on first launch, so back up first:
[Upgrading from 1.x](#upgrading-from-1x).
</details>

<details>
<summary><strong>Something broke. Where do I look?</strong></summary>

Start with **Help > Open Logs Folder**, then [TROUBLESHOOTING.md](TROUBLESHOOTING.md). It covers install failures,
startup messages, saving problems, AI messages and the code runners.
</details>

## Roadmap

**Planned, not promised.** I work on Dojo in my own time, so treat this as a direction, not a schedule.

- **Multi-platform.** One Dojo server running on your home network, with clients on Mac, iPhone and iPad as a web
  app. Your data would still stay on your own machine, with no cloud service. This is a design direction I want to
  explore. It does not exist yet, and I have not set a date.
- **A download you do not have to build.** A signed, notarized release would remove the Node step. It would also
  need a decision about distribution that has not been made.
- **The rest of the sample plan.** Phases 2 to 6 of the AI plan are outlines for now; their tickets are still to be written.
- **More sample content.** There are known gaps in the walkthrough library. For example, the Decode Ways problem has
  no walkthrough picture of its own yet (see [docs/known-content-gaps.md](docs/known-content-gaps.md)).

Ideas and bug reports are welcome as issues.

## Contributing

Dojo is a small, local-first app, and changes are welcome as issues and pull requests. Start with
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit, then [CONTRIBUTING.md](CONTRIBUTING.md) for the
setup, the development commands and the test suites (unit, end-to-end and desktop). The conventions are short: stay
local-first (no telemetry, no API keys), add tests with your change, and keep personal data out of the tree.

Other docs: [User guide](USER-GUIDE.md) (every screen), [Troubleshooting](TROUBLESHOOTING.md),
[Changelog](CHANGELOG.md).

## Licence and acknowledgements

Dojo is released under the [MIT License](LICENSE).

It stands on other people's work: Electron and Chromium, React, CodeMirror, Dexie, Pyodide (the Python runtime, under
MPL-2.0), three.js, and the self-hosted Chivo, Silkscreen and Space Mono fonts, among others. Each keeps its own
licence. See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). The installed app carries Electron's and Chromium's
licences in `Dojo.app/Contents/Resources/`.

The sample plan links to the free work of many teachers and sites. Thank you to them, and to the authors of the
READMEs I borrowed ideas from.
