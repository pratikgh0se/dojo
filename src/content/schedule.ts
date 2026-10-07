import type { PlanJson, PlanSchedule } from '../data/types'

/**
 * G6: the neutral sample day. The shipped plan.json carries these same values as its `schedule` block; a plan with
 * no schedule (an older plan, a test fixture) falls back to them field by field. A learner's own day comes from
 * DOJO_HOME/profile.json (server/profile.mjs), never from this file.
 */
export const SAMPLE_SCHEDULE: PlanSchedule = {
  intro:
    'Built around a full workday, a commute, exercise, and time with the people you live with. One block a day, tracks alternate, Friday is free, news gets one slot. Same shape every week for three years. The content changes; the container does not.',
  block: { start: '21:00', end: '21:50' },
  timeline: [
    { time: '07:00', what: 'Up. No learning in the morning; sleep matters more.' },
    { time: '08:00 to 08:30', what: 'Commute. Nothing planned. If you see something you want to watch later, capture the link to your inbox and move on.' },
    { time: '08:30 to 17:30', what: 'Work.' },
    { time: '17:30 to 18:00', what: 'Commute home.' },
    { time: '18:30 to 19:30', what: 'Exercise.' },
    { time: '19:30 to 21:00', what: 'Dinner and the people you live with.' },
    { block: true, what: 'The 50-minute block. Phone in another room.' },
    { time: '22:30', what: 'Sleep. Seven hours is the floor.' },
  ],
  timelineNote:
    'If the evening block does not work, swap it with exercise on alternating days rather than dropping either. Minimum sprint: if two weeks collapse, do the Saturday block twice and tick two tasks. That counts. Then slide the start date and continue; never restart.',
  restDay: 'Rest, exercise, nothing else.',
  inbox: 'a notes app or a message to yourself',
  protects: 'sleep, exercise, or family',
}

/** The plan's schedule, each missing field from the sample. */
export function scheduleOf(plan: Pick<PlanJson, 'schedule'> | null | undefined): PlanSchedule {
  const s = plan?.schedule ?? {}
  const block = s.block && typeof s.block.start === 'string' && typeof s.block.end === 'string' ? s.block : SAMPLE_SCHEDULE.block
  return {
    intro: s.intro ?? SAMPLE_SCHEDULE.intro,
    block,
    timeline: Array.isArray(s.timeline) && s.timeline.length ? s.timeline : SAMPLE_SCHEDULE.timeline,
    timelineNote: s.timelineNote ?? SAMPLE_SCHEDULE.timelineNote,
    restDay: s.restDay ?? SAMPLE_SCHEDULE.restDay,
    inbox: s.inbox ?? SAMPLE_SCHEDULE.inbox,
    protects: s.protects ?? SAMPLE_SCHEDULE.protects,
  }
}

/** Today's time line: "21:00 – 21:50". */
export const blockRange = (s: PlanSchedule): string => `${s.block.start} – ${s.block.end}`
/** The Ritual timeline's time cell: "21:00 to 21:50". */
export const blockSpan = (s: PlanSchedule): string => `${s.block.start} to ${s.block.end}`
