# Dojo user guide

Dojo is a study planner and practice app for a long study plan. It runs as a Mac app and keeps
all of your data on your own machine. It needs the internet only for the links you open, the optional link check
on a brief, and the optional AI features.

Dojo ships with a sample plan: a path of AI-infrastructure cards, a DSA track and a design track, a DSA problem bank,
a system design bank and a skill tree. You can replace it with your own plan (see
[Your own plan](#your-own-plan)).

This guide is for someone using the installed app. If you want to change the code, read
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). If something is not working, see
[TROUBLESHOOTING.md](TROUBLESHOOTING.md).

Screenshots of each screen are in the [README](README.md#a-day-in-dojo).

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
cd <repo>
npm ci
npm run install:app
```

This builds `Dojo.app` and installs it in `~/Applications`. Open it from there, or drag it to the Dock. To install it in
`/Applications` instead, run `npm run install:app -- --dest /Applications`.

- **Update:** pull the new code and run `npm ci` and `npm run install:app` again. Only the app bundle is
  replaced. Your data folder is never touched.
  Moving from Dojo 1.x to 2.0 is the one exception to "nothing happens to your data": the first launch converts it to
  the flat queue once, after taking a snapshot. Back up `~/Dojo` first; see
  [Upgrading from 1.x](README.md#upgrading-from-1x).
- **Install somewhere else:** `npm run install:app -- --dest <folder>`.
- **Keep your data somewhere else:** `npm run install:app -- --home <folder>`. The folder is remembered inside
  that copy of the app.
- **Remove:** `npm run uninstall:app` deletes `~/Applications/Dojo.app` and nothing else. Your data stays in
  `~/Dojo`.

The app is signed ad hoc on your machine during install. It is not notarized.

## First launch

When Dojo opens for the first time it creates its data folder (`~/Dojo`), starts its own small server on a free
local port (on `127.0.0.1`, not reachable from your network) and opens one window.

You see **Pick your start date**. Your plan begins on this date at local midnight. The field defaults to the next Monday. Choose a date and press **START · PLAN**. You can change the date
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

Dojo has six main places, in a rail down the left side (a bar along the bottom on a phone, with Today, Path, Board and
Review and a More sheet for the rest):

| Key | Place | What it is |
|---|---|---|
| 1 | **Today** | The one ticket that is next, and why. |
| 2 | **Path** | The whole queue, in order. |
| 3 | **Board** | A two-week sprint of your queue as columns, from To do to Done. |
| 4 | **Journal** | A two-minute entry about how the day went. |
| 5 | **Skills** | The map of what you are learning. |
| 6 | **Review** | Things that come back to you because they are due. |

Below them the rail has **Topics** (**AI**, **DSA**, **Designs**), **Practice** (**Banks**, **Atlas**) and, at the foot,
the **Guide** and a button that collapses the rail to icons. The gear at the top right opens **Settings** and the
shortcut list. **Ctrl or Cmd K** opens a search that jumps to any ticket, skill, screen or setting.

The save status sits in the header:

| Status | Meaning |
|---|---|
| Saved | Every change is on disk. |
| Saving… | A change is on its way to disk. |
| Not saved to disk | Dojo cannot reach its server. Hover for the reason. Your changes are kept in the window and sent when the server is back. |
| Read-only | This window is not allowed to change data (see [Where your data lives](#where-your-data-lives)). |
| N changes couldn't be saved | The server refused some changes. Click it to see them in Settings and retry. |

Press **?** (outside a text field) for the list of shortcuts. A ticket and a design session open inside the same
window, with the rail beside them.

## How the plan works

### Tickets

Everything you do is a **ticket** (the guide and the app also say card). Each one fits a single sitting: a video, a
reading, a build, a problem, a design or a short ritual. The plan produces them in a queue, in lanes (AI, DSA, Design
and Career); Today shows the one that is next, Path shows all of them.

| Ticket | Where it comes from |
|---|---|
| AI-track tickets (watch, read, build, write-up, ritual) | The plan's skill areas and phases |
| DSA problems | The DSA bank |
| Designs | The design bank |

A ticket is **Start**ed from Today, Path or Review and finished with **Done**. An unfinished ticket simply stays
next; nothing is trimmed or marked late.

### Pace

Your weekly minutes set the pace, not a calendar. **Settings, Pace** holds one box per weekday (minutes you can
give that day). Change a box and the finish month moves at once. There are no sprints to plan or to slip; the Board
shows a two-week window of your queue.

### XP and level

Finishing a card earns XP:

| Card | Base XP |
|---|---|
| Task, watch, read, stage | 10 |
| Problem | Easy 5, Medium 10, Hard 15 |
| Design | 20 |
| Codeforces problem | rating / 100, rounded, minus 7, at least 1 |

Help you open on the Do screen costs XP (see [The help ladder](#the-help-ladder)). A card's XP never goes below 0.
Your level (LV) is your total XP divided by 10. Your **form** (BASE up to SOVEREIGN) follows the
share of the plan's possible XP you have earned on plan tickets. Problems from the practice banks that are not on your
plan raise your level but not your form.

## The screens

### Today

One ticket, and why it is next ("you started this one", "next in your queue", "reviews are piling up", or that a
longer ticket waits for a longer day). **Start** (or Enter) opens it; **Done** marks it finished from the ticket page.
If something is due again, a badge points to Review. **Pick something else** lists a few other tickets that fit; picking
one changes nothing until you start it. Beside the ticket sit two optional rituals, the daily AI pulse (a 15-minute
check with an AI tool) and the weekly try-a-model run; skip either and it simply closes. Above them, **Pom** is a small
companion that changes form as your level rises (nine forms, BASE to SOVEREIGN, at levels 0, 10, 40, 100, 180, 300, 450,
650 and 900), with a bar to the next form. A form is never taken back. A drawer at the foot holds your stats.

### Path

The whole queue in order: **Doing**, **Up next** and **Done**, with lane chips (AI, DSA, Design, and Career if you
switch it on in Settings) and a search box. You can reorder what is up next, within its lane or into Doing. Start any
ticket from here. At most 3 tickets are shown as Doing before Path suggests finishing one.

### Board

Your queue laid out as a sprint, two weeks of your weekly minutes, in columns: **To do** (what fits in the minutes that
are left), **Backlog** (the rest of the queue), **Doing**, **Blocked**, **Need help** and **Done**. Move a card by
dragging it or with its menu. **Blocked** is for a ticket something outside you is holding up, and **Need help** is for
one where you want a person to look; you set both yourself, with a short reason, and the queue goes on without them. The
header shows how many of the sprint's tickets and hours are done. Lane chips narrow the columns.

### Journal

A two-minute entry about the day. A strip of the last week shows which days have an entry, and **No study today** marks a
day off without any penalty. For each ticket you worked on, choose how hard it was (**Again**, **Hard**, **Good**,
**Easy**) and whether you could explain it without notes (**No**, **Partly**, **Yes**). **Came up hard this week** lists
tickets that got two rough signals in 14 days, each with **Add to Review** to bring it back for another try.

### Skills

The map of what you are learning, in tabs: **AI** (ten areas, each with its progress and the areas it needs first; open an area and its topics are a tree too),
**DSA** and **Design** (each a tree of topics laid out in rows by what they build on, with the next topic highlighted), and
**Stats** (how much you have done and your pace). Pick an area or a topic to open its panel: what it builds on, its tickets
and the next one in it, which you can start from there.

### Review

What has come back because it is due, one card at a time, answer first: write your answer, then **Reveal**, compare it
with the stored one and mark yourself. Learning checks come back as questions; problems you gave up on or solved with help
come back as a replay, and designs that scored low as a redesign. A redo you pass moves out to 10 days and then 30 days.
**Skip for today** moves a card to the back of the queue and writes nothing.

### AI topics

Reached from the rail under Topics. Every AI topic on one page, grouped by area, with its tickets, how many are done, their
kinds and the hours. Filter by phase or kind; a row opens that topic in Skills.

### Guide

A short in-app page, "How Dojo works": the daily loop, where things live, Board and sprints, Review and banks, Skills,
rituals and getting unstuck, design sessions, asking people, and the shortcuts. It is at the foot of the rail.

### DSA

Reached from the rail under Topics, or with Ctrl or Cmd K. The DSA bank of the plan: problems solved, hard problems solved, premium problems left, a chart by difficulty and
a heatmap with one row per topic. Click a cell to tick or untick that problem. Click a topic to see its warm-up
walkthroughs, the pattern, a note, study links, and the problem list with LeetCode and NeetCode links, a tick box
and a **Do** button for each problem.

### Designs

Reached from the rail under Topics, or with Ctrl or Cmd K. The design bank: designs done, deep dives covered, the **Next design**, charts, evidence from your sessions,
the **Tier ladder** and the **Rubric** (20 points). Pick a tier to see its designs; each has a **Start session**
button.

A **design session** is a 45-minute box:

1. **Setup**: read the prompt, the deep dives and the references, then choose who plays the person across the table.
   **Solo · AI partner** (the default) gives you an AI partner; tick **Skip the AI partner** to work alone (Solo).
   **With someone** lets a friend play the partner with a card in a second window; no AI speaks in that mode.
   Press **START · DESIGN**.
2. **Drawing**: build your diagram on the canvas and write in the **Notes** tab (requirements, assumptions, API,
   data model with schema tables, trade-offs, open questions). The **Deep dives** tab lists the questions to cover. The
   canvas locks at 45 minutes, or at once when you press **CLOSE · DESIGN**.
3. **Five-question close**: answer the closing questions, then **NEXT · SCORE**.
4. **Score the session**: score each deep dive 0, 1 or 2, each of the seven lenses (load, data, consistency, failure,
   latency, cost, evolution) 0, 1 or 2, add trade-offs (chose, over, because), and enter the rubric score 0 to 20.
   With the AI partner its grade appears here (five scored items, checks to review, what a stronger version does); with
   a human partner their scores are filled in for you to change. Press **COMPLETE · SESSION**.
5. **Done**: your diagram next to an AI reference diagram (not drawn for a With someone session, which uses no AI), the
   differences ("information, not a score"), and **Export PNG** for either diagram. When a redesign is due, **REDO · DESIGN**
   starts a new session in the same mode.

**The AI partner is a thinking coach.** It speaks first, asks one question at a time, and never gives you the answer or a
list of options. You answer in the chat in your own words. **Hint** asks a sharper question (three at most per session).
It reads your notes and your diagram, so what you write in the Notes tab counts.

**With someone.** Open the partner card from the **Partner** tab: it opens in a second window so your friend can read it
while you draw. It shows the prompt, an opening line, follow-up questions to ask, a read-only copy of your design so far,
and a scoring sheet (five rubric rows 0 to 4, four deep dives 0 to 2). If the window is blocked, **Show card here** puts the
same card in the tab. Their sheet pre-fills your score form; you can change anything before you confirm.

**Canvas.** Click a kind in the palette (or drag it onto the canvas) to add a block. Four more items sit beside the kinds:
**Box** (your own component with a name, a description and a glyph), **Note** (a sticky text note, up to 20), **Table**
(a block linked to a schema table in the notes, which shows its columns) and **Frame** (a labelled group, up to 8; a block
belongs to at most one). **2D** and **Iso** switch the view.

**Keys on the canvas.** Press **?** to see the list. N adds a note, C a box, T a table; G puts the selected block in a new
frame and Shift+G removes its frame; the arrow keys move the selected block or note; Delete removes it; L starts a link from
the selected block; Esc leaves link mode or goes back to the canvas; Ctrl/Cmd+. swaps focus between the canvas and the notes;
Ctrl/Cmd+Enter sends your chat answer.

**Discard session** (top bar, while a session is running) deletes the session after you confirm; the card itself is
unchanged and you can start again from Setup. A finished session cannot be discarded.

A redesign is scheduled 30 days later when the rubric is under 14 or a deep dive scored 0. Due redesigns appear in
Review.

### Atlas

Reached from the rail under Practice, or with Ctrl or Cmd K. A map of algorithm patterns. Each row shows whether you have seen or predicted it, and whether your solutions reached
for it or avoided it.
Search by LeetCode number, problem name or phrase; when nothing matches, press Enter to ask the AI which pattern
fits. Open a pattern to see its walkthroughs (**Play**, **Predict**, **Two-up** to compare two, **Own input**),
**Trace my own input**, and the plan problems tagged with it. **Sort by problems left** reorders the rows.

### Banks

Reached from the rail under Practice. Three tabs, **DSA**, **Design** and **AI**.

- **DSA** holds the **Plan bank** (the problems on your plan) and **Mine** (your own list). Dojo ships no third-party
  problem lists. Filter by difficulty and pattern, search (press `/`), and tick problems. Ticking a problem that is on
  your plan ticks the plan card. Other problems become done cards with their own XP; unticking removes them.
  - **Mine** starts empty. Paste a LeetCode or Codeforces link, or type a problem name, press **Classify**, and the AI
    suggests the pattern and difficulty; accept it to add the problem. You can edit or remove your entries. A link to a
    problem already on your plan reuses the plan card.
- **Design** and **AI** hold question banks for the plan's topics, answer first: write your answer, reveal the stored one,
  then use **Add to Review** to see the question again later. Pick a topic filter to narrow the list.

### Settings tab

See [Settings](#settings) below.

## Working on a card: the Do screen

Open a ticket with **Start** on Today, Path or Review. Escape, or **Back**, returns to where you came from.

The top line shows the ticket, the save status, the card's net XP and the timer.

### Statement, brief and links

The **Statement** shows the title, difficulty, pattern and sources. Below it is the card's **Brief**, if it has
one. **Open** buttons open the card's links. Opening a link does not start anything: **Start** is the one way to
begin.

### The timer

Each ticket has one timer, a single block as long as the **Session length** in [Settings](#settings) (25 minutes
until you change it; 5 to 180). **Start** (the accent button, for example **START · PROBLEM** or **START · WATCH**)
begins the countdown. **Pause** and **Resume** stop and restart it. At zero it says "Time is up. Keep going or
finish." and waits; nothing ends by itself. **End session** closes the block and asks three short questions: done,
stuck on, next step. A timer that runs on one ticket stays one click away from other screens.

- A **problem** is finished with **Solved**, **Solved with help** or **Give up** (see below). **Space** starts,
  pauses or resumes the timer, and `d` marks the problem solved.
- Every other kind of ticket (watch, read, build, write-up, ritual, design) has **Start** and then **Done**
  (**DONE · WATCH**, **DONE · BUILD** and so on). A ritual can also be finished with **Done** without starting the
  timer. A design ticket opens its design session instead of a timer.
- **Focus mode** (`f` while a timer is running, **Escape** to leave) hides everything but the brief, the clock and a
  Notes box; **End session** and **Exit focus mode** stay at the foot.
- If the Mac sleeps past the end of the block, the timer waits for you.

### The attempt log

For problems and designs: "What is the invariant? What did you try?". For AI-track cards: a repo or commit URL and
a proof note.

### The help ladder

Problem tickets have a help ladder; the other kinds do not. The ladder on the right has five rungs. Each costs XP from that card:

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
Review when due. A redo passes when you solve the card using at most a Hint. Passes move the redo on to
10 days and then 30 days; a failed redo keeps its stage and is rescheduled. During a redo, Picture, Video and
Solution cost double. Passing refunds XP: up to half of the help you paid at the first pass, the rest at the second,
and a bonus of 3 at the third.

## Briefs and learning checks

A **brief** turns a card into a concrete plan: a goal, steps with links, minutes, a day type, what you will learn,
the outcome, a deliverable and, for learning cards, questions.

- **Edit and approve.** On the Do screen, **Edit brief** changes any part of it, and **Approve** marks it approved.
  **Check links** tests the brief's links and flags broken ones.
- **AI-track build cards never get code from the AI.** Their deliverable is your own code, typed by hand.

**Mark done** depends on the card:

- A **learning card** (a watch or read card, or a capstone watch session) opens **Check your understanding**.
  Multiple-choice answers are graded by Dojo; open answers are graded by the AI. The card is done when every answer
  passes, or when at most one is partial and none fail. Otherwise you see corrections and a redo is scheduled 3
  days out; you can fix your answers and try again at once.
- A **build card** asks for the **Deliverable**. **Get feedback** is optional and asks the AI for feedback only; it
  never writes code and never finishes the card for you.

A card with no brief can be finished directly from Today or its ticket page.

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
text, what you paste into Classify, your AI partner chat messages, and for grading your proof note and commit summary plus, if you set a project repo, the
last 20 commit subjects, the graded commit's file list and `git diff --stat` of that repo.

| Feature | Where |
|---|---|
| Hint (two levels) | Do, help ladder |
| Picture (problem walkthrough) | Do, help ladder, on problems |
| Diagram | Do, help ladder, on designs; the reference diagram at the end of a design session |
| Solution | Do, help ladder, after Give up |
| AI partner and its grade | Design sessions with the AI partner (Solo · AI partner) |
| Grade | **Get feedback** on a deliverable |
| Classify | Banks, Mine; Atlas search when nothing matches locally |
| Check your understanding | Mark done on learning cards (Dojo grades multiple-choice answers itself, but the check runs through the AI) |

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

**Grading and your project repo.** The artifact grader belongs to the capstone screen, which is not in this version (it returns later). Your project repo setting in [profile.json](#your-profile-file) is kept for it.

## Keyboard shortcuts

The number keys do nothing while you are typing in a field or an editor, on the design canvas, or with Ctrl, Cmd or
Alt held.

**Anywhere else**

| Key | Does |
|---|---|
| 1 | Today |
| 2 | Path |
| 3 | Board |
| 4 | Journal |
| 5 | Skills |
| 6 | Review |
| Ctrl or Cmd K | Opens the search that jumps to anything (also works inside a text field) |
| ? | Opens the list of shortcuts |
| Esc | Closes a menu or dialog |

**On a screen**

| Where | Key | Action |
|---|---|---|
| Today | Enter | Start the ticket shown |
| Do | Escape | Leave focus mode, or go back |
| Do, a problem | Space | Start, pause or resume the timer |
| Do, timer running | f | Focus mode on or off |
| Banks | / | Search |
| Atlas | Escape | Close the two-up view, then the pattern panel |
| Walkthrough players | Left, Right, Space | Step back, step forward, play or pause |
| Do, Trace panel | Left, Right, Home, End, Space | Step back or forward, first or last step, play or pause |
| Design canvas, box focused | Arrows, Delete or Backspace, L, Escape | Move it, remove it, start a link, cancel a link |
| Design canvas | ? | The list of canvas shortcuts (N, C, T, G, Shift+G, arrows, Delete, L, Ctrl/Cmd+., Esc) |
| Design AI partner chat | Cmd+Enter | Send |

## Settings

| Section | What you can do |
|---|---|
| Plan start | Change the start date (YYYY-MM-DD). |
| Pace | Minutes you can give each weekday; the finish month follows at once. |
| Preferences | Session length and display options. |
| Changes that couldn't be saved | Appears only when the server refused changes. Lists them, with **Retry**. |
| Debug · Pom | A preview only: pick a form to see it, play the form-up animation, or type a level to see which form it gives. It changes and saves nothing. |
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
cd <repo>
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
| `plan.schedule` | Legacy field. The screens that showed it (Ritual, Overview) are gone, so it is kept in the file but not shown. |
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

- The file must be a plan v2: `planFormat` set to `2`, a `planVersion`, and the `areas`, `phases`, `nodes`, `tickets`,
  `tasks`, `dsa_bank` and `design_bank` lists (any may be empty; the DSA and Designs tabs then say so) plus a `mix`
  with seven weekly `budgets` (Sunday first). Every id must be unique. An older plan with a `sprints` list and a
  `rotation` is no longer read.
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
