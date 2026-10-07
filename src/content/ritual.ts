import type { PlanSchedule } from '../data/types'
import type { Weekday } from '../lib/dates'
import { blockSpan } from './schedule'
import type { ProseSection, ProseTable } from './types'

// G6: the learner's own day (intro, block time, timeline, inbox) is plan data (`plan.schedule`, content/schedule.ts);
// this file keeps the shape of the week, which is the same for everyone.

export const FULL_DAY: Record<Weekday, string> = {
  Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday',
}

/** The duration line of each old per-day card; the label itself comes live from plan.json.rotation. */
export const DAY_DURATIONS: Record<Weekday, string> = {
  Mon: '50 min, evening',
  Tue: '50 min, evening',
  Wed: '50 min, evening',
  Thu: '50 min, evening',
  Fri: '0 min',
  Sat: '3 hours + 30 min, morning',
  Sun: '2 h + 30 min',
}

/** "A weekday, concretely", from the plan's schedule; the block row's time is the schedule's block. */
export function weekdayTimeline(s: PlanSchedule): ProseTable {
  return {
    title: 'A weekday, concretely',
    head: ['Time', 'What'],
    rows: s.timeline.map(r => [r.block ? blockSpan(s) : r.time ?? '', r.what]),
    note: s.timelineNote,
  }
}

export const newsSlot = (s: PlanSchedule): ProseSection => ({
  title: 'Saturday news slot',
  intro: 'New models and new videos every day are the biggest threat to this plan. The rule is capture now, read later, in one slot.',
  items: [
    { lead: 'One slot.', text: 'Saturday, after the build block, 30 minutes, timer on. That is the only time for AI news, new model releases, and YouTube browsing.' },
    {
      lead: 'Capture, do not open.',
      text: `Anything you see during the week goes into your inbox (${s.inbox}). You do not watch it then. Saturday you pick at most two items from the inbox.`,
    },
    {
      lead: 'One digest.',
      text: "AI News from smol.ai is a free daily digest; read Saturday's issue only. It covers Astro, Fable, Muse Spark, and the rest better than forty videos.",
      links: [{ label: 'news.smol.ai', url: 'https://news.smol.ai/' }],
    },
    {
      lead: 'YouTube only via links.',
      text: 'Install Unhook to hide the home feed and recommendations. Open YouTube only from a link in this plan.',
      links: [{ label: 'unhook.app', url: 'https://unhook.app/' }],
    },
    { lead: 'Testing a new model', text: 'is a Saturday news-slot activity with a 30-minute cap, unless a task in this plan needs it.' },
    {
      lead: 'The reframe.',
      text: 'Every release you miss this week will still exist in three years. The math and the models underneath them will not have changed. That is what you are learning.',
    },
  ],
})

export const SPRINT_CLOSE: ProseSection = {
  title: 'Sprint close (every second Sunday)',
  items: [
    { text: 'All sprint tasks ticked or explicitly moved to the next sprint, never silently skipped.' },
    { text: 'Redo list updated with every problem or design that failed.' },
    { text: 'One line to a room or to someone in the mentor log.' },
  ],
}

export const BLOCK_CLOSE: ProseSection = {
  title: 'Block close (every fourth sprint)',
  items: [
    { text: 'Proof of work pushed to a public repo with a README a stranger could run.' },
    { text: 'One post with one figure.' },
    { text: "Skill tree check: is the block's node above 70%? If not, the next sprint is catch-up, not new material." },
    { text: 'Mentor log updated.' },
  ],
}

export const STUCK_PROTOCOL: ProseSection = {
  title: 'When stuck for more than 30 minutes',
  items: [
    { text: 'Open your AI and use the tutor prompts on the Working with AI tab: "teach me this at three levels", then "quiz me". Ten minutes.' },
    { text: 'Still stuck: write the 4-part question and post it in the room. Move to the next task.' },
    {
      text: 'Stuck across two sessions: open your local Claude Code login and ask for one read-only snippet that shows the shape of the fix. You read it, then type the real thing yourself; the DSA problem or the rebuild is still yours to solve, not the agent\'s.',
    },
    { text: 'Never let one task block a sprint. Mark it, move on, come back when answered.' },
  ],
}
