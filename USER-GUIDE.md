# Dojo user guide

Dojo is a study planner and practice app for a long, sprint-based study plan. It runs as a Mac app and keeps
all of your data on your own machine. It needs the internet only for the links you open, the optional link check
on a brief, and the optional AI features.

Dojo ships with a sample plan: 72 two-week sprints with an AI track and an interview track, a DSA problem bank,
a system design bank, a skill tree and a set of communities. You can replace it with your own plan (see
[Your own plan](#your-own-plan)).

This guide is for someone using the installed app. If you want to change the code, read
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). If something is not working, see
[TROUBLESHOOTING.md](TROUBLESHOOTING.md).

Screenshots are not included yet.

## Contents

1. [What you need](#what-you-need)
2. [Install, update and remove](#install-update-and-remove)
3. [First launch](#first-launch)
4. [Finding your way around](#finding-your-way-around)
5. [How the plan works](#how-the-plan-works)
6. [The screens](#the-screens)
7. [Working on a card: the Do screen](#working-on-a-card-the-do-screen)
8. [Briefs and learning checks](#briefs-and-learning-checks)
9. [Running code: Go and Python](#running-code-go-and-python)
10. [AI features](#ai-features)
11. [Keyboard shortcuts](#keyboard-shortcuts)
12. [Settings](#settings)
13. [Backups, restore and export](#backups-restore-and-export)
14. [Your profile file](#your-profile-file)
15. [Your own plan](#your-own-plan)
16. [Where your data lives](#where-your-data-lives)

## What you need

| What | Needed for | Notes |
|---|---|---|
| macOS | Everything | Dojo is built as a Mac app. The Go runner uses the macOS `sandbox-exec` tool. |
| Node.js 22.13 or newer, with npm | Building and installing the app | The app uses Node's built-in SQLite module. Only needed to build; the installed app carries its own runtime. |
| Go 1.22 or newer | The Go code runner (optional) | `brew install go`. Without it, everything else works and the Go panel says Go is missing. |
| Claude Code, logged in | AI features (optional) | Dojo runs the `claude` command line tool with your existing login. No API key is stored. |

Python needs nothing extra: a Python runtime (Pyodide) is bundled inside the app.

## Install, update and remove

From a clone of this repository:

```sh
cd <repo>/app
npm install
npm run install:app
```

This builds `Dojo.app` and installs it in `~/Applications`. Open it from there, or drag it to the Dock.

- **Update:** pull the new code and run `npm install` and `npm run install:app` again. Only the app bundle is
  replaced. Your data folder is never touched.
- **Install somewhere else:** `npm run install:app -- --dest <folder>`.
- **Keep your data somewhere else:** `npm run install:app -- --home <folder>`. The folder is remembered inside
  that copy of the app.
- **Remove:** `npm run uninstall:app` deletes `~/Applications/Dojo.app` and nothing else. Your data stays in
  `~/Dojo`.

The app is signed ad hoc on your machine during install. It is not notarized.

## First launch

When Dojo opens for the first time it creates its data folder (`~/Dojo`), starts its own small server on a free
local port (on `127.0.0.1`, not reachable from your network) and opens one window.

You see **Pick your start date**. Sprint 1 of 72 begins on this date at local midnight, and each sprint is 14
days. The field defaults to the next Monday. Choose a date and press **Start the plan**. You can change the date
later in [Settings](#settings).

After that Dojo opens on **Today**.

A few things to know about the app itself:

- There is one Dojo window and one running copy. Opening Dojo again brings the existing window forward.
- Closing the window, or Cmd+Q, quits Dojo. That also stops its server, any AI request in progress and any code
  run.
- The window remembers its size and position.
- Links to outside pages open in your default browser.
- **View** menu: Actual Size, Zoom In, Zoom Out, Toggle Full Screen.
- **Help** menu: **Open Data Folder** (opens `~/Dojo`) and **Open Logs Folder**.

## Finding your way around

The top bar has five tabs: **Today**, **Board**, **DSA**, **Designs** and **AI**, then a **More** menu with
**Map**, **Progress**, **Week**, **Overview**, **Atlas**, **Banks**, **Mentors**, **Ritual** and **Settings**.
When the window is narrower than 768 pixels, Designs and AI move to the top of the More menu.

On the right of the top bar is the save status:

| Status | Meaning |
|---|---|
| Saved | Every change is on disk. |
| Saving… | A change is on its way to disk. |
| Not saved to disk | Dojo cannot reach its server. Hover for the reason. Your changes are kept in the window and sent when the server is back. |
| Read-only | This window is not allowed to change data (see [Where your data lives](#where-your-data-lives)). |
| N changes couldn't be saved | The server refused some changes. Click it to see them in Settings and retry. |

The bottom of most screens shows a one-line reminder of the keyboard shortcuts. The Do screen and design sessions
fill the whole window and hide the top bar.

## How the plan works

### Cards

Everything you do is a **card** (the code calls them tickets). The plan produces three families:

| Card | Where it comes from | Default time |
|---|---|---|
| AI-track and interview-track tasks | Each sprint's task lists. A task can also be a "watch", "read" or capstone "stage" card. | 50 min |
| DSA problems | The DSA bank, one topic per sprint | 30 min |
| Designs | The design bank, spread across the sprints named in each tier | 45 min |

A card's time can be changed by its brief (see [Briefs](#briefs-and-learning-checks)).

### Sprints and the weekly rotation

A sprint is 14 days. The plan has 72 of them. Each weekday has a role from the plan's rotation. In the sample
plan: Monday AI watch, Tuesday interview code, Wednesday AI rebuild, Thursday interview design, Friday off,
Saturday AI build and break, Sunday interview and teach-back.

For suggestions, Dojo treats Monday to Wednesday as **focus** days (room for about 120 minutes), Thursday and
Friday as **light** days (60) and Saturday and Sunday as **long** days (240).

### XP and level

Finishing a card earns XP:

| Card | Base XP |
|---|---|
| Task, watch, read, stage | 10 |
| Problem | Easy 5, Medium 10, Hard 15 |
| Design | 20 |
| Codeforces problem | rating / 100, rounded, minus 7, at least 1 |

Help you open on the Do screen costs XP (see [The help ladder](#the-help-ladder)). A card's XP never goes below 0.
Your level (LV) is your total XP divided by 10. Your **form** (BASE up to SOVEREIGN, shown in Vitals) follows the
share of the plan's possible XP you have earned on plan cards. Problems from the practice banks that are not on your
plan raise your level but not your form.

### Moving cards between sprints

| Action | Where | What it does |
|---|---|---|
| Roll-over | Automatic | When a sprint ends, its unfinished cards move to the current sprint. They keep their XP and note where they rolled from. Today says "N cards rolled from Sprint X". Sprints that had already ended when you set your start date do not roll. |
| Slide | Board card, or key `s` | Moves one unfinished card to the next sprint (or to the current sprint, if the card is further behind) and marks it as slid. Done cards never slide, and nothing slides back before the current sprint. You can also drag a card onto a sprint in the sprint strip. |
| Slide sprint | Board header | Moves every unfinished card of the sprint you are viewing to the next one, after a confirmation that shows the target sprint's size. |
| Shift plan | Board header | Moves every unfinished card from the viewed sprint (or the current one, whichever is later) onward by one sprint. |
| Move to sprint… | Board card | Moves a card to any sprint. |
| Rebalance? | Board, when a sprint is over budget | Proposes moving the latest, not-started, unpinned cards to the next sprint until the sprint fits. You choose which to accept. |
| Pin | Board card | A pinned card is never proposed by Rebalance. |
| Undo | Board header | Undoes the last slide, shift, move or rebalance. The button shows how many steps can be undone (up to 20 events). |

At most 3 cards can be in **Doing** at once.

### The workload budget

**Core minutes per sprint** (Settings, default 1440, which is 24 hours) is your time budget. Today and the Board
compare the minutes of the sprint's unfinished cards against it. A split card counts through its sessions.

## The screens

### Today

The first screen, top to bottom:

- **Now**: what to do next, with the study block time from your schedule on block days. **Spar · 50** and
  **Spar · 25** start a timer for that card without leaving Today. **Open** opens the card's main link.
  **Start** (or Enter) opens the card on the Do screen.
- **Vitals**: your level, XP and progress toward the next form; the **Sprint clock** (sprint dates, a strip of the
  14 days, "Carrot HP", which is how many tasks are left, focus minutes today and milestone badges); and
  **Consistency**, a calendar of the last 8 weeks.
- **Sprint by sprint**: done, left behind and to-do cards per sprint.
- **Load check**: whether the sprint fits, and real focus minutes in the last 7 days. When the sprint is heavy, an
  **Ask what to slide** button asks the AI which cards to push to the next sprint; you confirm with
  **Slide these**.
- **Workload**: planned hours against the budget, the roll-over note, and up to 5 cards that fit today's day type
  and the time you have left today.
- **Dig in**: drawers you can open: **This sprint** (the sprint's AI and interview tasks), **Left behind**
  (unticked tasks from earlier sprints), **Redo** (redos and redesigns due today or earlier), the sprint's **DSA**
  topic with study links, and the design for the week.

### Board

One sprint at a time. The title shows the sprint you are viewing and "now" for the current one.

- **Sprint strip**: one cell per sprint. Click a cell, or use the arrow keys, to view another sprint.
- **Load bar**: cards that belong to this sprint, cards slid in from earlier sprints, and the plan average.
- **Columns**: **Slid in**, **Todo** (with its total minutes), **Doing** and **Done**. Drag cards between
  columns, or use the keyboard.
- **Each card** shows its source, chips for bank, pinned, split and brief status, the **Pin** and
  **Move to sprint…** tools, and **Do**, **Slide** and **Done** buttons.
- **Header**: **Slide sprint**, **Shift plan**, **Undo**, and **Draft briefs for Sprint N**.

Moving a learning card to Done opens its learning check instead (see [Briefs](#briefs-and-learning-checks)).

### DSA

The DSA bank of the plan: problems solved, hard problems solved, premium problems left, a chart by difficulty and
a heatmap with one row per topic. Click a cell to tick or untick that problem. Click a topic to see its warm-up
walkthroughs, the pattern, a note, study links, and the problem list with LeetCode and NeetCode links, a tick box
and a **Do** button for each problem.

### Designs

The design bank: designs done, deep dives covered, the **Next Sunday design**, charts, evidence from your sessions,
the **Tier ladder** and the **Rubric** (20 points). Pick a tier to see its designs; each has a **Start session**
button.

A **design session** is a 45-minute box:

1. **Setup**: read the deep dives and references, choose **Solo** or **Interviewer**, and press **Start · 45 min**.
2. **Drawing**: build your diagram on the canvas. In Interviewer mode an AI interviewer asks questions and you
   answer in a chat panel. The canvas locks at 45 minutes, or when you end the drawing.
3. **Five-question close**: answer the closing questions, then **Next: score**.
4. **Score the session**: score each deep dive and each of the seven lenses (load, data, consistency, failure,
   latency, cost, evolution) 0, 1 or 2, add trade-offs (chose, over, because), and enter the rubric score 0 to 20.
   In Interviewer mode the interviewer's grade appears here. Press **Complete session**.
5. **Done**: your diagram next to an AI reference diagram, the differences ("information, not a score"), and
   **Export PNG** for either diagram.

A redesign is scheduled 30 days later when the rubric is under 14 or a deep dive scored 0. Due redesigns appear in
Today's Redo drawer.

### AI (capstone)

The AI track's capstone project, stage by stage:

- **Evidence** tiles.
- **Learn → build → prove**: three cubes per stage. Learn is a watch card; build is a build card plus a commit;
  prove is a teach-back plus a grade of at least 3 out of 5, or a solved blank test. Each stage has a
  **Blank test** button: rebuild one piece from a blank file, with no video and no agent.
- **Learn board**, **Build board** and **Artifact timeline**. **Add artifact** records something you built:
  title, stage, repo URL, commit, write-up link, proof note and status (not started, building, runs, measured,
  written up). An artifact can carry measures and can be **graded** by the AI.
- **Measures wall**, with **Export Markdown** (saves `dojo-measures.md`).
- **Stage ladder** and stage detail, **Session balance** (watch, rebuild, build, teach-back done against total),
  the **Optional shelf** of extra resources, and **Working with AI** (tutor prompts to copy).

### Map

- **Journey**: the plan's phases. Click one to open its first sprint.
- **Sprint path**: every sprint; click one to see its AI and interview tasks. In the sprint panel the left and
  right arrow keys step between sprints.
- **Skill tree**: skills and what they need. A skill unlocks when each skill it needs is 70 percent done. Pick a
  node to see what it is, why it matters, what holds it back, and the sprints that carry it.

### Progress

Rings for All, AI, Interview, DSA and Designs; a **Burn-up** chart of planned against done; **Pace** (ahead, on
pace or behind per track, hours in, hard problems solved and a projected finish sprint); outcomes per sprint;
study sessions; evidence; help ladder usage; redo hit rate; **Reviews**; and stage badges.

**Reviews** builds a sprint review. Pick a sprint and press **Build review**. The numbers (planned, done, focus
days, slipped cards, longest streak, redo and check pass rates) are computed by Dojo; the AI only writes the prose
and a "Do better next sprint" list. When a sprint ends, Dojo also builds its review automatically (at most 3 per
launch, newest first). If the AI is not available, the numbers are kept and **Build review** writes the prose later.

### Week

The days of this week, each with its role from the rotation, its cards, and the cards done and minutes spent; a
14-day calendar of the current sprint; and minutes per week for the last 8 weeks against a 540-minute target.

### Overview

The plan on one page: a timeline of all sprints (with the checkpoint at sprint 38 and a line for today), what the
plan covers, rules of the road, what "understanding everything" means here, and what is deliberately out of
scope.

### Atlas

A map of algorithm patterns. Each row shows whether you have seen or predicted it, and whether your solutions reached
for it or avoided it.
Search by LeetCode number, problem name or phrase; when nothing matches, press Enter to ask the AI which pattern
fits. Open a pattern to see its walkthroughs (**Play**, **Predict**, **Two-up** to compare two, **Own input**),
**Trace my own input**, and the plan problems tagged with it. **Sort by problems left** reorders the rows.

### Banks

Practice banks beyond the plan: the **Plan bank** (the problems on your plan) and **Mine** (your own list). Dojo
ships no third-party problem lists. Filter by difficulty and pattern, search (press `/`), and tick problems. Ticking
a problem that is on your plan ticks the plan card. Other problems become done cards with their own XP; unticking
removes them.

- **Mine**: starts empty. Paste a LeetCode or Codeforces link, or type a problem name, press **Classify**, and the AI
  suggests the pattern and difficulty; accept it to add the problem. You can edit or remove your entries. A link to a
  problem already on your plan reuses the plan card.

### Mentors

How to find and work with mentors: the protocol (from picking two communities to keeping a mentor log), a mentor
log template, the communities from your plan grouped as learner rooms, contributor rooms and programs, a weekly
community budget and people worth following.

### Ritual

The weekly rhythm: the rotation, a weekday timeline built from your schedule with the study block highlighted, the
Saturday news slot, sprint close, block close, what to do when stuck for more than 30 minutes, and tutor prompts to
copy.

### Settings tab

See [Settings](#settings) below.

## Working on a card: the Do screen

Open a card with **Start** on Today, **Do** on the Board or in any list, or Enter on a focused Board card. Escape,
or **Back**, returns to the Board.

The top line shows the card, its sprint, the save status, the card's net XP and the timer.

### Statement, brief and links

The **Statement** shows the title, difficulty, pattern and sources. Below it is the card's **Brief**, if it has
one. **Open** buttons open the card's links; opening one starts the timer if it is not already running.

### Timer and study sessions

The **Timer** panel has **Start 25 min**, **Start 50 min** and a custom length from 1 to 240 minutes, then
**Pause**, **Resume** and **Retreat** (abandon the block; its minutes still count for the attempt). Space starts,
pauses or resumes it.

**Start session** plans a longer study session: pick the cards it covers, write what you will do, choose a cycle
(25/5, 50/10, or custom focus of 1 to 180 and break of 1 to 60 minutes) and whether a soft chime plays at each
switch. Every fourth focus block is followed by a long break (three short breaks long). The session keeps running
when you move to other screens. During a session:

- **Focus mode** (or `f`) hides everything but the session.
- If a focus block passes with no help opened, no note typed and no tick, a **Stuck?** dialog offers **Open the
  next help rung**, **Take a 5-minute break** or **I'm fine**. Nothing happens unless you choose.
- If the Mac sleeps past the end of a phase, the session waits for you to resume or end it.
- **End session** asks three short questions: done, stuck on, next step.

### The attempt log

For problems and designs: "What is the invariant? What did you try?". For AI-track cards: a repo or commit URL and
a proof note.

### The help ladder

The ladder on the right has five rungs. Each costs XP from that card:

| Rung | Unlocks | Problem | Design | Task |
|---|---|---|---|---|
| Attempt | Always | 0 | 0 | 0 |
| Hint | After 10 minutes on this attempt's timer | 2 | 3 | 2 |
| Picture | After Hint | 3 | 4 | 2 |
| Video | After Picture | 3 | 3 | 0 |
| Solution | Only after you give up | 5 | 5 | not available |

- **Hint** is written by the AI. After the first hint you can ask for a second, stronger one at the same cost.
- **Picture** is an AI-made, step-by-step walkthrough for a problem, an AI architecture diagram for a design, and
  links to watch for a task.
- **Video** shows video links.
- **Solution** is written by the AI, only after **Give up**, and comes with a short quiz.

### Finishing an attempt

- **Solved**: only while you have used no help.
- **Solved with help**.
- **Give up**: unlocks the Solution and schedules a redo.

After **Solved** or **Solved with help** on a problem with known approaches, Dojo asks **Which approach did you
use?**. Your answer feeds the approach coverage in Atlas.

### Redos

Giving up, or solving with help at the Picture rung or deeper, schedules a **redo** 3 days later. Redos appear in
Today's Redo drawer when due. A redo passes when you solve the card using at most a Hint. Passes move the redo on to
10 days and then 30 days; a failed redo keeps its stage and is rescheduled. During a redo, Picture, Video and
Solution cost double. Passing refunds XP: up to half of the help you paid at the first pass, the rest at the second,
and a bonus of 3 at the third.

## Briefs and learning checks

A **brief** turns a card into a concrete plan: a goal, steps with links, minutes, a day type, what you will learn,
the outcome, a deliverable and, for learning cards, questions.

- **Draft briefs.** On the Board, **Draft briefs for Sprint N** asks the AI for a brief for every unfinished card in
  that sprint that has none, one card at a time. It keeps running if you leave the Board; a small indicator shows
  its progress. A card that fails is skipped, and running it again picks up whatever is still missing.
- **Edit and approve.** On the Do screen, **Edit brief** changes any part of it, and **Approve** marks it approved.
  **Check links** tests the brief's links and flags broken ones.
- **AI-track build cards never get code from the AI.** Their deliverable is your own code, typed by hand.
- **Split into sessions.** A large card can be split into 2 to 12 sessions. The card is done when all its sessions
  are.

**Mark done** depends on the card:

- A **learning card** (a watch or read card, or a capstone watch session) opens **Check your understanding**.
  Multiple-choice answers are graded by Dojo; open answers are graded by the AI. The card is done when every answer
  passes, or when at most one is partial and none fail. Otherwise you see corrections and a redo is scheduled 3
  days out; you can fix your answers and try again at once.
- A **build card** asks for the **Deliverable**. **Get feedback** is optional and asks the AI for feedback only; it
  never writes code and never finishes the card for you.

A card with no brief can be finished directly from the Board.

## Running code: Go and Python

Problems that have a problem pack show a code panel on the Do screen. Twenty problems ship with packs (LeetCode 3,
11, 55, 56, 62, 91, 153, 198, 206, 207, 215, 322, 543, 684, 743, 802, 875, 877, 1143 and 1584); the panel appears
when one of them is on your plan.

- Choose **Go** or **Python** with the language switch. Your code is saved per card and per language as you type.
- **Run** runs the examples. **Submit** runs every case.
- On these cards **Solved** and **Solved with help** stay disabled until a Submit in the current attempt passes
  every case ("Submit 5/5 to unlock Solved").
- To watch your solution step by step, use the toolkit: `import "dojo/tk"` in Go or `from dojo import tk` in
  Python. The starter code shows an example, such as a DP table with `tk.Table` and `t.Set`, or graph, heap, queue
  and union-find views.
- After a run that used the toolkit, a **Trace** panel opens below the code: **Previous step**, **Play** and
  **Next step**, a step slider, the table with its dependency arrows, the call tree, and the graph or heap views. Left
  and Right step, Home and End jump to the first and last step, and Space plays or pauses.

**Go** runs on your Mac and needs Go 1.22 or newer. Dojo looks for `go` on your login shell's PATH and in the usual
Homebrew and `/usr/local` locations. Without it the panel says "Go isn't installed: install it with brew install
go". Each run is built and run in a fresh temporary folder under the macOS sandbox, with no network, no access to
your home folder or your Dojo data, a 3-second time limit, 512 MiB of memory, 1 MiB of output and 64 KiB of code.
One run happens at a time. The first build after a new data folder takes a few seconds; later builds are faster.

**Python** runs inside the Dojo window with the bundled Pyodide runtime, isolated from the rest of the app and from
the network. The first run shows "Loading Python…". Runs have a 3-second limit.

## AI features

The AI features use **your own Claude Code login**. Dojo runs the `claude` command line tool on your Mac
(`claude -p`, always asking for the Sonnet model, with tools, MCP servers, hooks and slash commands turned off). It
stores no API key and has no account of its own.

**What leaves your machine:** the text of each request is sent to Anthropic by the `claude` tool, the same as any
other Claude Code session. That is the card's title and text, your attempt notes, your answers, your deliverable
text, what you paste into Classify, your design interview messages, card titles for Ask what to slide, a sprint's
review numbers, and for grading your proof note and commit summary plus, if you set a project repo, the last 20
commit subjects, the graded commit's file list and `git diff --stat` of that repo.

| Feature | Where |
|---|---|
| Hint (two levels) | Do, help ladder |
| Picture (problem walkthrough) | Do, help ladder, on problems |
| Diagram | Do, help ladder, on designs; the reference diagram at the end of a design session |
| Solution | Do, help ladder, after Give up |
| Interviewer and interview grade | Design sessions in Interviewer mode |
| Grade | AI tab artifacts; **Get feedback** on a deliverable |
| Ask what to slide | Today, Load check, when the sprint is heavy |
| Classify | Banks, Mine; Atlas search when nothing matches locally |
| Draft briefs | Board |
| Check your understanding | Mark done on learning cards (Dojo grades multiple-choice answers itself, but the check runs through the AI) |
| Sprint review prose | Progress, Reviews, and the automatic review after a sprint ends |

**Without Claude Code.** Everything that is not in the table above works without it. When you use an AI feature
and Dojo cannot find `claude`, the panel shows **Claude Code is not installed or not on PATH.**, the raw error
underneath, and a **Retry** button. Install Claude Code, make sure `claude` works in Terminal, then press Retry.
Dojo finds `claude` through your login shell's PATH and the usual install locations (Homebrew, `/usr/local/bin`,
`~/.local/bin`, the newest nvm Node), because an app started from the Dock gets no shell PATH.

Other messages you may see:

| Message | What it means |
|---|---|
| The AI helper is not running. Quit Dojo and open it again. | The window cannot reach Dojo's own server. Quit and reopen Dojo. |
| The AI helper rejected the request. | The request was malformed or asked for something not allowed, such as a repo other than your project repo. |
| The AI helper failed. | `claude` ran but exited with an error. The raw line under it shows the tool's own message. Check that `claude` works in Terminal. |
| The AI helper timed out. | A request ran for more than 90 seconds. |
| The AI helper is busy. Try again in a moment. | Two AI requests are already running. |
| The AI returned something unusable. | The reply did not match the expected format, even after one automatic retry. |
| That request is not allowed before you give up. | Solutions are only given after Give up. |

**Grading and your project repo.** To let the grader read your commits, set your project repo in
[profile.json](#your-profile-file) and restart Dojo. The grader then reads the repo read-only when an artifact's repo
URL ends with the same folder name as your local repo. Until you set one, the AI tab says "Set your project repo
..." and grading uses the repo URL and the commit summary you paste. **Request grade** needs a repo URL and a
commit. A grade passes at 3 out of 5.

## Keyboard shortcuts

Shortcuts do nothing while you are typing in a field, and the global ones are off on the Do screen and in design
sessions.

**Anywhere else**

| Key | Goes to |
|---|---|
| 1 or t | Today |
| 2 | Board |
| 3 | DSA |
| 4 | Designs |
| 5 | AI |
| 6 | Map |
| 7 | Progress |
| 8 | Week |
| 9 | Overview |
| 0 | Settings |
| a | Atlas |
| b | Banks |
| m | Opens the More menu (then Up, Down, Home, End, Enter, Escape) |

**On a screen**

| Where | Key | Action |
|---|---|---|
| Today | Enter | Start the card shown in Now |
| Board, card focused | Enter | Open it on the Do screen |
| Board, card focused | d | Done |
| Board, card focused | s | Slide to the next sprint |
| Board, card focused | Shift+Right, Shift+Left | Move one column right or left |
| Board, sprint strip | Left, Right | Previous or next sprint |
| Do | Escape | Leave focus mode, or go back to the Board |
| Do | Space | Start, pause or resume the timer (when no study session is running) |
| Do, study session | f | Focus mode on or off |
| Banks | / | Search |
| Atlas | Escape | Close the two-up view, then the pattern panel |
| Map, sprint panel | Left, Right | Previous or next sprint |
| Walkthrough players | Left, Right, Space | Step back, step forward, play or pause |
| Do, Trace panel | Left, Right, Home, End, Space | Step back or forward, first or last step, play or pause |
| AI tab, Build board, artifact focused | Shift+Right, Shift+Left | Move it to the next or previous status |
| Design canvas, box focused | Arrows, Delete or Backspace, L, Escape | Move it, remove it, start a link, cancel a link |
| Design interviewer | Cmd+Enter | Send |

## Settings

| Section | What you can do |
|---|---|
| Plan start | Change the start date (YYYY-MM-DD). Shows where today falls: "Today is sprint N, day D of 14". |
| Workload | Core minutes per sprint, from 30 to 20160. Default 1440. |
| Changes that couldn't be saved | Appears only when the server refused changes. Lists them, with **Retry**. |
| Backups | Where your data is, **Back up now**, and the list of snapshots with **Restore**. |
| Plan data | The plan version, the database file, your project repo (or "not set"), and cards archived because the plan changed (with the XP they keep). |

## Backups, restore and export

**Automatic backups.** Each time Dojo starts it takes a snapshot for the day if there is none yet, and again every 24
hours while it runs. Snapshots are named `dojo-YYYY-MM-DD.db` and the newest 30 are kept.

**Back up now** (Settings, Backups) takes a snapshot named `dojo-YYYY-MM-DD-HHMMSS.db`. The newest 30 of these are
kept too.

**Restore.** Press **Restore** next to a snapshot and confirm. Dojo first saves your current data as a
`pre-restore-<time>.db` snapshot (these are never deleted automatically), then replaces it, and the window reloads.
The history of changes is kept. A restore is blocked while there are changes that could not be saved; retry them
first.

Every snapshot is a complete SQLite database. Copying `~/Dojo/backups` to another disk is a simple off-machine
backup.

**Export to Postgres SQL.** From your clone:

```sh
cd <repo>/app
npm run db:export-pg
```

This reads `~/Dojo/dojo.db` (or `DOJO_HOME/dojo.db`) read-only, so it can run while Dojo is open, and writes
`~/Dojo/export/dojo-pg-<time>.sql`: a `dojo` schema, the tables, one INSERT per row, and the row counts to check
after loading. It needs Node 22.13 or newer.

Other exports: **Export Markdown** on the Measures wall, and **Export PNG** for design diagrams.

## Your profile file

An optional file, `~/Dojo/profile.json`, holds your own values without changing the shipped plan:

```json
{
  "projectRepo": "~/projects/my-capstone",
  "plan": {
    "schedule": {
      "intro": "One block a day, tracks alternate, Friday is free.",
      "block": { "start": "21:00", "end": "21:50" },
      "timeline": [
        { "time": "07:00", "what": "Up." },
        { "time": "08:30 to 17:30", "what": "Work." },
        { "block": true, "what": "The study block. Phone in another room." }
      ],
      "timelineNote": "If the evening block does not work, swap it with exercise on alternating days.",
      "restDay": "Rest, exercise, nothing else.",
      "inbox": "a notes app",
      "protects": "sleep, exercise, or family"
    },
    "learner": { "patternsRepo": "https://example.com/my-pattern-notes" }
  }
}
```

| Key | Effect |
|---|---|
| `projectRepo` | The local repo the grader may read. An absolute path or one starting with `~/`. Unset by default. |
| `plan.schedule` | Your day. `block` is the weekday study block shown on Today and highlighted in Ritual. `timeline` is the "A weekday, concretely" table in Ritual (the row with `"block": true` takes its time from `block`). `timelineNote` is the note under it. `restDay` is Today's sentence on the rest day. `inbox` is where links go (Ritual, Saturday news slot). `protects` finishes Overview's sentence "Compressing it means skipping ...". `intro` opens Ritual. Missing keys fall back to the sample. |
| `plan.learner.patternsRepo` | Your own coding-patterns notes. Used for the DSA study links and for any plan link written as `{{learner.patternsRepo}}`; such links are dropped while it is unset. |

Only `schedule` and `learner` under `plan` are used; other plan keys in the file are ignored. A file that is not valid
JSON is ignored. Restart Dojo after editing it. The `DOJO_PROJECT_REPO` environment variable, when set, wins over
`projectRepo`.

## Your own plan

The plan is the file `public/data/plan.json` in your clone. It is built into the app, so to use your own:

1. Edit or replace `public/data/plan.json`.
2. Run `npm run install:app` again and reopen Dojo.

On every start Dojo reconciles your cards with the plan. Progress on cards whose id is still in the plan is kept,
and their text and links are refreshed. New ids become new cards. Cards whose id left the plan are archived and keep
their XP; Settings lists them. To rename an id without losing its history, add an `idMap` entry from the old id to
the new one.

Keep in mind:

- The file needs a non-empty `sprints` list, a `rotation`, and `dsa_bank` and `design_bank` lists (either may be
  empty; the DSA and Designs tabs then say so). Every id must be unique.
- Sprints are always 14 days and the plan is laid out over 72 sprints, whatever the file says.
- A design tier named "... (sprints 21 to 24)" spreads its designs across those sprints.
- If the file cannot be used, Dojo shows **Plan data problem** with the reason and does not seed a partial plan.

The full shape of the file is described in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#the-plan-data-model).

## Where your data lives

Everything is in `~/Dojo` (or the folder you chose at install). **Help, Open Data Folder** opens it.

| Path | What |
|---|---|
| `dojo.db` (and `dojo.db-wal`, `dojo.db-shm`) | Your progress, in SQLite. The source of truth. |
| `backups/` | Daily and manual snapshots, and pre-restore copies. |
| `logs/server.log` | The app's log. Rotated to `server.log.1` at 5 MB. **Help, Open Logs Folder** opens it. |
| `electron/` | The window's browser state, including its working copy of your data. |
| `writer.token` | A random secret that lets the Dojo window change data. |
| `window.json`, `desktop.json` | Window size and position; the last port used. |
| `gocache/` | The Go build cache (after your first Go run). Trimmed when it passes 1 GiB. |
| `export/` | Postgres exports, when you make one. |
| `profile.json` | Your optional profile. |

The folder is readable only by you, and the database and backups are private to your user.

**The window is the writer.** The Dojo window keeps a working copy of your data and sends every change to
`dojo.db` moments after you make it. If you open Dojo's local address in an ordinary browser, that page is a
**read-only** view: it shows "Read-only: open Dojo from the Dojo app to make changes" and refuses changes.

**Starting completely fresh.** Quit Dojo and rename `~/Dojo` (for example to `~/Dojo-old`). The next launch creates
a new, empty data folder and asks for a start date again.

**Network use.** Dojo's server listens only on `127.0.0.1`. The only outbound requests it makes itself are
**Check links** on a brief (a HEAD or GET to each public link, never to private or local addresses). AI requests go
through the `claude` tool, and the links you open go through your browser.
