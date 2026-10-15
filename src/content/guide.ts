import type { DestinationId } from '../rules/nav'

export type GuideSectionId = 'overview' | 'destinations' | 'board' | 'review' | 'skills' | 'ritual' | 'design' | 'mentors' | 'shortcuts'
export interface GuideSection { id: GuideSectionId; title: string; paragraphs: string[]; prompts?: string[] }

/** NAV-29: one sentence per rail destination. The page draws the destination's name as a link to its route and then this text. */
export const DEST_LINE: Record<DestinationId, string> = {
  today: 'shows one ticket to do next, and why it is next.',
  path: 'lists the whole queue and lets you reorder it.',
  board: 'lays this sprint out in columns, from To do to Done.',
  journal: 'is a two-minute entry about how the day went.',
  skills: 'shows the map of what you are learning, area by area.',
  review: 'brings back what is due again, one card at a time.',
  ai: 'lists every AI topic with its tickets and hours.',
  dsa: 'holds the problem bank, by topic and difficulty.',
  designs: 'holds the design tiers and opens a design session.',
  banks: 'holds the question banks, answer first.',
  atlas: 'maps algorithm patterns to the pictures and problems that use them.',
  guide: 'is this page, which explains how Dojo works.',
}

export const GUIDE: readonly GuideSection[] = [
  {
    id: 'overview',
    title: 'The daily loop: Today, a ticket, Done, journal',
    paragraphs: [
      'Dojo is a queue of single-sitting tickets. Each one is a video, a reading, a build, a problem, a design or a short ritual.',
      'Open Today. It shows one ticket and why it is next. Press Start and work the ticket. Press Done when it is finished, and the next one is waiting. Near the end of the day, write a few lines in the journal: how it went and what was hard.',
      'Your weekly minutes set the pace, not a calendar. Change them in Settings and the finish month moves at once. Nothing is trimmed, nothing is marked late, and an unfinished ticket simply stays next.',
    ],
  },
  {
    id: 'destinations',
    title: 'Where things live',
    paragraphs: [],
  },
  {
    id: 'board',
    title: 'Board and sprints',
    paragraphs: [
      'The Board lays this sprint out as columns: To do, Backlog, Doing, Blocked, Need help and Done. A sprint is two weeks of your minutes. To do holds what fits in the minutes that are left; Backlog holds the rest of the queue.',
      'Move a card by dragging it or with its menu. Blocked is for a ticket something outside you is holding up, and Need help is for one where you want a person to look. You set both yourself, and the queue goes on without them.',
    ],
  },
  {
    id: 'review',
    title: 'Review and banks',
    paragraphs: [
      'Review brings back what is due again, one card at a time. Write your answer first, then reveal the stored one and grade yourself. Problems and designs come back as a replay.',
      'The question banks hold extra questions for DSA, Design and AI topics. Answer first there too, then add any question to Review to see it again later.',
    ],
  },
  {
    id: 'skills',
    title: 'Skills and topics',
    paragraphs: [
      'Skills is the map of what you are learning. It has the AI areas and, next to them, the DSA and Designs trees. Each node is a topic with its own tickets.',
      'AI topics lists every AI node with its ticket counts and hours. DSA and Designs open the problem bank and the design tiers; the Designs list has a search box that looks at titles, tiers and difficulty.',
    ],
  },
  {
    id: 'ritual',
    title: 'Rituals and getting unstuck',
    paragraphs: [
      'A ritual is a small recurring job. The daily AI pulse is a short check with an AI tool, and Try a model is a weekly run of one small open model. Each is optional. Skip one and it simply closes.',
      'When you are stuck, write the question down, try for ten minutes, then ask a tutor for a hint, not the answer. If it still will not move, mark the ticket Need help on the Board and take the next ticket. It will still be there.',
    ],
    prompts: [
      'Explain [topic] to me as if I know Linux and Kubernetes but not machine learning. Then ask me two questions to check that I followed.',
      'Here is my answer to [question]. Tell me what is missing or wrong. Do not give me the full answer.',
      'I am designing [system]. Ask me for the numbers first, then push on every assumption, one question at a time.',
    ],
  },
  {
    id: 'design',
    title: 'Design sessions',
    paragraphs: [
      'A design session is a guided sitting on a system design ticket. You set the requirements and numbers, sketch on the canvas, and answer the deep dives. A short grade at the end shows where the design was thin.',
      'Open one from Designs, from Today or Path, or by typing the design in the palette. Opening a session starts nothing until you press Start.',
    ],
  },
  {
    id: 'mentors',
    title: 'Asking people',
    paragraphs: [
      'A person who has done this work can turn a week of guessing into an hour. Ask one specific question, say what you already tried, and ask for one next step rather than the whole answer.',
      'Keep a short note of who helped and what changed. Thank them with what you learned and what you built.',
    ],
  },
  {
    id: 'shortcuts',
    title: 'Shortcuts',
    paragraphs: [
      'Press 1 for Today, 2 for Path, 3 for Board, 4 for Journal, 5 for Skills and 6 for Review. The keys do nothing while you are typing.',
      'Ctrl or Cmd with K finds a ticket, a skill, a screen or a setting. Press ? on any screen to list every shortcut.',
    ],
  },
]
