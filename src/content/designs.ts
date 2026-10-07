import type { ProseSection } from './types'

export const RUBRIC: { item: string; points: number }[] = [
  { item: 'Requirements and numbers', points: 4 },
  { item: 'API and data model', points: 3 },
  { item: 'High-level design meeting the numbers', points: 4 },
  { item: 'Two deep dives with real trade-offs', points: 6 },
  { item: 'Failure modes and operations', points: 3 },
]

export const RUBRIC_TOTAL = 20

export const DONE_MEANS =
  'A design is done when you have done it in 45 minutes on a whiteboard or a recording, self-graded against the rubric, compared with a reference, and written one page in the vault.'

export const DESIGN_PRACTICE: ProseSection = {
  title: 'Hard design problems, and how to practice them',
  intro:
    'Forty-eight designs in six tiers, from a Dynamo-style store to an agent orchestration platform. Each has four deep dives you must be able to answer without notes.',
  items: [
    {
      lead: 'Where your experience is the answer',
      text: ', the deep dive says so. Bring the real numbers from the metrics, scheduler, logging, and authorization work.',
    },
    { lead: 'Sunday is design day.', text: 'One design per Sunday, recorded. The Thursday block is for the reading behind it.' },
  ],
}

export const DESIGN_SOURCES: ProseSection = {
  title: 'Sources',
  items: [
    {
      lead: 'Designing Data-Intensive Applications',
      text: 'is the one book worth buying, about the price of a month of any subscription. Read it with the tutor protocol, one chapter per Thursday.',
      links: [{ label: 'book', url: 'https://dataintensive.net/' }],
    },
    {
      lead: "Hello Interview's free guides",
      text: "for the method; ByteByteGo's YouTube channel (free) for reference solutions to compare against after you have done your own. The paid tiers of both are not needed.",
      links: [
        { label: 'Hello Interview', url: 'https://www.hellointerview.com/learn/system-design/in-a-hurry/introduction' },
        { label: 'ByteByteGo channel', url: 'https://www.youtube.com/@ByteByteGo' },
      ],
    },
    {
      lead: "Martin Kleppmann's distributed systems lectures",
      text: ', free on YouTube in 20-minute pieces, are the video version of DDIA.',
      links: [{ label: 'playlist', url: 'https://www.youtube.com/playlist?list=PLeKd45zvjcDFUEv_ohr_HdUFe97RItdiB' }],
    },
    {
      lead: 'Mocks',
      text: "come from Exponent's and interviewing.io's free peer tiers, or a partner from the rooms. Nothing paid.",
      links: [
        { label: 'Exponent', url: 'https://www.tryexponent.com/practice' },
        { label: 'interviewing.io', url: 'https://interviewing.io/' },
      ],
    },
    {
      lead: 'The papers',
      text: 'linked per design: Dynamo, GFS, Bigtable, Spanner, Borg, Monarch, Zanzibar, Raft, MegaScale, PagedAttention. Reading the original beats any summary.',
    },
    {
      lead: 'MIT 6.824',
      text: 'lectures for the distributed-systems core.',
      links: [{ label: 'course', url: 'https://pdos.csail.mit.edu/6.824/' }],
    },
    {
      lead: "Anthropic's engineering posts",
      text: 'for the agentic tier.',
      links: [{ label: 'engineering blog', url: 'https://www.anthropic.com/engineering' }],
    },
  ],
}
