// Per-job prompt bodies for the real helper (integration spec §2): the job's task, the context it
// needs, the exact OUTPUT SCHEMA and one example reply that passes validateOutput. The system prompt
// (guardrails.ts) is unchanged. Pure: no React, no Dexie, no DOM. The helper gets this through
// server/shared-entry.ts -> server/gen/ai-shared.mjs.
import { ATLAS_PATTERNS } from '../content/patterns'
import { FAKE_DIAGRAM, FAKE_PICTURE_STEPS } from './fake'
import { FORGE_TYPED_BY_HAND, TEACHBACK_DELIVERABLE_PROMPT } from './forgeConst'
import { PROMPT_CORE, SOLUTION_PSEUDOCODE_MAX_LINES, WORD_LIMITS } from './guardrails'
import { LENSES, type InterviewFinal, type JobName, type JobOutput, type TranscriptMessage } from './types'
import {
  BRIEF_LIMITS, DIAGRAM_KINDS, DIAGRAM_MAX_NODES, REVIEW_MAX_WORDS, LINK_KINDS, PACKET_KINDS, PICTURE_LIMITS,
  SRALGO2_OPS, SRALGO2_TYPES, SRALGO_OPS, SRALGO_TYPES, ZONE_KINDS,
} from './validate'

export const TRANSCRIPT_TEXT_MAX = 2000
/** M1: caps on the other free-text fields a learner types directly into a job's context. */
export const ATTEMPT_LOG_MAX = 2000
export const PROOF_NOTE_MAX = 2000
export const CLASSIFY_INPUT_MAX = 4000

/** The plan's 20-point design rubric (chain D RUBRIC_BREAKDOWN; item names = the fake grade's). */
export const INTERVIEW_RUBRIC = [
  { item: 'Requirements and numbers', max: 4 },
  { item: 'API and data model', max: 3 },
  { item: 'High-level design that meets the numbers', max: 4 },
  { item: 'Two deep dives with real trade-offs', max: 6 },
  { item: 'Failure modes and operations', max: 3 },
] as const

/** lab/Algorithm Atlas.dc.html section 09 "prompt", verbatim (AI "picture": "use the Atlas prompt verbatim"). */
const ATLAS_PICTURE_PROMPT = `You are given a question (algorithm, math, game theory, data structure). Produce ONE JSON for <sr-algo> (atoms: array grid graph tree list stack queue hash stack-frames intervals bits) or <sr-algo2> (atoms: forest plane numberline tape sets).
1. Classify the pattern (see the map on Algorithm Atlas). 2. Choose ≤ 3 structures: one main picture + side panels. 3. Write 15–60 steps; every step carries op, line, say (the reason), vars.
Contract: { title, complexity, structures: { name: { type, ... } }, code: [≤ 8 lines], steps: [ { op, s|g, ..., line, say, vars } ] }
Ops (sr-algo): set swap compare mark clear pointer window push pop shift visit edge label cell cellMark cellHl call ret link say
Ops (sr-algo2): link set mark clear pointer seg line range push sketch window move say
States: current · compare · visited · done · bad · frontier · path
Return only the JSON.`

const join = (xs: readonly string[]) => xs.join(' ')

export const OUTPUT_SCHEMAS: Record<JobName, string> = {
  hint: `{ "hint": string }
1. hint is ONE nudge of at most ${WORD_LIMITS.hint} words.
2. Level 1: do not name the algorithm, pattern or data structure. Level 2: you may name the pattern in one word and say what to watch.
3. No code and no pseudocode.`,
  picture: `{ "title": string, "complexity": string, "structures": { "<name>": { "type": <type>, ...fields } }, "code": string[], "steps": [ { "op": <op>, "say": string, "line": number, "vars": object, ...op arguments } ] }
1. At most ${PICTURE_LIMITS.structures} structures. type is one of: ${join(SRALGO_TYPES)} (sr-algo) or ${join(SRALGO2_TYPES)} (sr-algo2). Do not mix the two groups.
2. 15 to 60 steps (at least ${PICTURE_LIMITS.minSteps}, at most ${PICTURE_LIMITS.maxSteps}). Every step has op and a non-empty say: the reason for the step, one sentence.
3. op is one of: ${join(SRALGO_OPS)} (sr-algo) · ${join(SRALGO2_OPS)} (sr-algo2).
4. Op arguments, sr-algo: set(s,i,v) swap(s,i,j) compare(s,i,j) mark(s,i,state) clear(s) pointer(name,s,i|null) window(s,lo,hi) push(s,v) pop(s) shift(s) visit(g,n,state) edge(g,u,v,state) label(g,n,text) cell(s,r,c,v) cellMark(s,r,c,state) cellHl(s,cells,state) call(s,frame) ret(s) link(s,i,next) say(). sr-algo2: link(s,i,next) mark(s,i,state) pointer(name,s,i) seg(s,i,j,state) line(s,a,b,c) range(s,lo,hi,state) push(s,v) sketch(s,key,v) window(s,k) move(s,item,to). s or g is a key of structures.
5. state is one of: current compare visited done bad frontier path.
6. code: at most ${PICTURE_LIMITS.codeLines} lines of pseudocode. Never use the words def function const let var class import lambda public static, and never "=>". for, while, if and return are fine.
7. Arrays hold at most ${PICTURE_LIMITS.arrayItems} values; graphs and trees at most ${PICTURE_LIMITS.nodes} nodes; grids at most ${PICTURE_LIMITS.gridSide} × ${PICTURE_LIMITS.gridSide}.
8. title is at most ${PICTURE_LIMITS.titleChars} characters and complexity at most ${PICTURE_LIMITS.complexityChars} (for example "O(n log n) · O(1)"). Neither uses < or >.`,
  diagram: `{ "layout": "layered", "nodes": [ { "id": string, "kind": <kind>, "label": string, "sub"?: string } ], "links": [ { "from": <node id>, "to": <node id>, "kind": <link kind>, "label"?: string } ], "zones": [ { "label": string, "kind": <zone kind>, "nodes": [<node id>] } ], "flows": [ { "path": [<node id>, ...], "packet": <packet>, "label": string } ] }
1. layout is "layered".
2. 1 to ${DIAGRAM_MAX_NODES} nodes with unique short ids.
3. kind is one of: ${join(DIAGRAM_KINDS)}.
4. link kind is one of: ${join(LINK_KINDS)}.
5. zone kind is one of: ${join(ZONE_KINDS)}.
6. packet is one of: ${join(PACKET_KINDS)}.
7. Every link, zone and flow names only node ids that exist in nodes.
8. One flow labelled "hot path" for the main request path, then one flow or zone per deep dive, labelled "dive <n>: <few words>".`,
  interview: `{ "say": string, "done": false }
1. say is at most ${WORD_LIMITS.interview} words, spoken to the candidate, doing exactly what THIS TURN says.
2. Ask one thing. Never answer your own question and never give the design away.`,
  grade: `{ "score": integer 0-5, "max": 5, "passed": boolean, "feedback": string[], "missing": string[], "commitFound"?: boolean }
1. Rubric: the artifact exists and runs (1) · the core mechanism is hand-written, not generated (2; look for reasoning vs boilerplate in the diff) · there is a measurement or a test (1) · the note explains one thing learned (1).
2. passed is true exactly when score >= 3.
3. feedback: at most 3 items, at most ${WORD_LIMITS.grade} words in total.
4. missing: what would raise the score; [] when nothing is missing.
5. commitFound: include it only when git evidence is given; true when the evidence shows the named commit, else false.
6. Never write, edit or propose code for the learner's repository.`,
  solution: `{ "approach": string, "pseudocode": string[], "complexity": string, "quiz": [ { "q": string, "a": string }, { "q": string, "a": string }, { "q": string, "a": string } ] }
1. approach: at most ${WORD_LIMITS.solution} words of prose: the invariant first, then the steps.
2. pseudocode: at most ${SOLUTION_PSEUDOCODE_MAX_LINES} lines, language-neutral.
3. complexity: time and space, e.g. "O(n) time · O(1) space".
4. quiz: exactly 3 questions whose answers are a few words, so a loose text match can check them.`,
  suggest_slide: `{ "slide": [ { "id": string, "reason": string } ], "keep": [ { "id": string, "reason": string } ] }
1. Every due ticket id appears exactly once, in slide or in keep. Use only the given ids.
2. slide holds exactly "Count to slide" tickets (fewer only when fewer are due).
3. Prefer sliding tickets that were slid fewer times. Keep a Monday watch and its Wednesday build together. Never slide the sprint's whole DSA topic. Keep the Sunday design.
4. reason: one short sentence.`,
  classify: `{ "title": string, "pattern": <label>, "difficulty": "E" | "M" | "H", "source": string, "note": string, "approaches": [ { "name": string, "pattern": <label> | null, "complexity": string, "best"?: true } ] }
1. pattern is exactly one of these 36 labels: ${ATLAS_PATTERNS.join(' | ')}.
2. difficulty is E, M or H.
3. source: "LeetCode" for a leetcode.com URL, "Codeforces" for a codeforces.com URL, else "Text".
4. note: one line, "Suggested <PATTERN> · <E|M|H>" and at most 8 more words.
5. approaches: 2 to 4 ways to solve it, brute force first and the best last; each name at most 4 words; exactly one has "best": true; never include libraryKey.`,
  brief: `{ "goal": string, "steps": [ { "text": string, "url"?: string } ], "minutes": integer, "dayType": "focus" | "light" | "long", "learn": string[], "outcome": string, "deliverable": { "kind": "answers" | "code" | "artifact" | "note" | "explanation", "prompt": string }, "questions": [ { "id": string, "kind": "open" | "mcq", "q": string, "choices"?: string[], "keyIdeas"?: string[], "correct"?: integer } ], "split"?: [ { "title": string, "minutes": integer } ] }
1. goal: one sentence, what the learner will be able to do. outcome: what "done" looks like, in one sentence.
2. steps: 1 to ${BRIEF_LIMITS.steps} exact, ordered actions, each starting with a verb. url only when you are sure the link is real (http or https); prefer the links given in the context.
3. minutes: an honest estimate from ${BRIEF_LIMITS.minMinutes} to ${BRIEF_LIMITS.maxMinutes}; sum video lengths and allow time for the deliverable. dayType: "focus" for deep work, "light" for reading or review that fits a tired day, "long" for a weekend build.
4. learn: 1 to 4 short phrases naming what the learner will learn.
5. deliverable.kind: "answers" for a video or a reading (then give 2 to 5 questions), "code" for something built, "artifact" for a diagram or a written piece, "note" for a short write-up, "explanation" for a teach-back card. deliverable.prompt says exactly what to hand in.
6. questions: open questions carry keyIdeas (2 to 4 phrases a good answer touches). An mcq has 3 to 4 choices and "correct", the zero-based index of the right one. Use unique ids q1, q2, ...
7. For a forge ticket deliverable.kind is "code", deliverable.prompt says "${FORGE_TYPED_BY_HAND}", questions is [] and no step contains code. A teach-back card (see the context) is the exception: its deliverable.kind is "explanation", deliverable.prompt says "${TEACHBACK_DELIVERABLE_PROMPT}", questions is [] and no step contains code; the steps say what to sketch on paper or explain in writing.
8. A learning card (see the context) always has deliverable.kind "answers" with 2 to 5 questions, whatever else it involves.
9. split: only when the work is longer than 90 minutes; 2 to ${BRIEF_LIMITS.splitMax} sessions of 45 to 90 minutes each, each with a title and minutes. Otherwise leave it out.`,
  check: `{ "results": [ { "id": string, "verdict": "pass" | "partial" | "fail", "correction": string, "pointer": string } ] }
1. One result per question, in the same order, with the question's id.
2. Open question: "pass" when the answer touches the key ideas in its own words, "partial" when it is on the right track but misses one, "fail" otherwise. Judge the idea, not the wording.
3. MCQ: "pass" only when the chosen index equals correct, else "fail".
4. correction: "" on a pass; otherwise one short sentence saying what to fix. Never write code.
5. pointer: "" on a pass; otherwise where to look, such as "Step 2" or the name of the section to revisit.`,
  review_sprint: `{ "prose": string, "doBetter": string[] }
1. prose: a short, direct note addressed to the learner ("you"), at most ${REVIEW_MAX_WORDS} words, in two parts: what went well and what did not.
2. doBetter: 2 to 3 concrete changes for next sprint, one short sentence each.
3. Use only the numbers given. Do not change or invent numbers.`,
}

/**
 * UAT cu-5 P2-2: the grade job for a written teach-back. Same shape and pass rule as the artifact grade, but the rubric judges
 * prose: there is no repo, commit, diff or measurement to ask for.
 */
export const GRADE_EXPLANATION_SCHEMA = `{ "score": integer 0-5, "max": 5, "passed": boolean, "feedback": string[], "missing": string[] }
1. Rubric for a written teach-back: it names the core mechanism and what each part is for (2) · it works one concrete example or number through it (1) · it says what breaks, or why it is built that way (1) · it is in the learner's own words and stands on its own, with no copied wording or hand-waving (1). Judge it against the stage rubric given in the context.
2. passed is true exactly when score >= 3.
3. feedback: at most 3 items, at most ${WORD_LIMITS.grade} words in total.
4. missing: the ideas that would raise the score; [] when nothing is missing.
5. This is prose, not code: there is no repository, commit, diff, test or measurement. Never ask for one, never mention commitFound.
6. Never write the explanation for the learner and never write code.`

export const INTERVIEW_FINAL_SCHEMA = `{ "done": true, "score": integer 0-20, "perItem": [ { "item": string, "points": integer, "note": string } ], "oneThingToStudy": string, "deepDives": [0|1|2, 0|1|2, 0|1|2, 0|1|2], "lenses": { ${LENSES.map(l => `"${l}": 0|1|2`).join(', ')} } }
1. perItem has exactly these five items, in this order, points from 0 to the maximum: ${INTERVIEW_RUBRIC.map(r => `${r.item} (max ${r.max})`).join(' · ')}.
2. score is the sum of the perItem points.
3. deepDives scores the four deep dives in order: 0 blank, 1 hand-wave, 2 trade-off with a number or a failure mode.
4. lenses scores all seven lenses on the whole transcript, 0/1/2.
5. note: one sentence per item. oneThingToStudy: one concrete topic.`

const BRIEF_EXAMPLE: JobOutput<'brief'> = {
  goal: 'Explain how a hash map resolves collisions and why lookups stay fast.',
  steps: [
    { text: 'Watch the collision handling section of the linked lecture', url: 'https://example.com/lecture' },
    { text: 'Pause after each example and predict the bucket before it is shown' },
    { text: 'Write three sentences on what you learned' },
  ],
  minutes: 60, dayType: 'focus',
  learn: ['chaining versus open addressing', 'load factor'],
  outcome: 'You can explain a lookup on a full table in your own words.',
  deliverable: { kind: 'answers', prompt: 'Answer the questions' },
  questions: [
    { id: 'q1', kind: 'open', q: 'Why does lookup stay O(1) on average?', keyIdeas: ['hash spreads keys', 'short buckets'] },
    { id: 'q2', kind: 'mcq', q: 'What does a resize fix?', choices: ['long buckets', 'key types'], correct: 0 },
  ],
}
const CHECK_EXAMPLE: JobOutput<'check'> = { results: [{ id: 'q1', verdict: 'partial', correction: 'Say why the buckets stay short.', pointer: 'Step 2' }, { id: 'q2', verdict: 'pass', correction: '', pointer: '' }] }
const REVIEW_EXAMPLE: JobOutput<'review_sprint'> = {
  prose: 'You showed up on 9 of 14 days and finished 6 of 8 cards. The two that slipped were both builds.',
  doBetter: ['Start builds on Saturday morning.', 'Cut one card.', 'Redo the missed check first.'],
}

export const OUTPUT_EXAMPLES: { [J in JobName]: JobOutput<J> } = {
  hint: { hint: 'Two land cells touching side by side belong to the same answer. What could you do to a cell once it is counted?' },
  picture: {
    title: 'Max scan · example shape only',
    complexity: 'O(n)',
    structures: { a: { type: 'array', values: [3, 1, 4, 1, 5] } },
    code: ['best = 0', 'for i in 1..n-1', '  if a[i] > a[best]', '    best = i', 'return best'],
    steps: FAKE_PICTURE_STEPS.map(s => ({ ...s })),
  },
  diagram: JSON.parse(JSON.stringify(FAKE_DIAGRAM)),
  interview: { say: 'Say you pick a token bucket at the gateway. Where does the bucket live when you run twenty gateway nodes?', done: false },
  grade: {
    score: 3, max: 5, passed: true,
    feedback: ['The engine runs and the backward pass is written by hand.', 'The note says what was learned about the chain rule.'],
    missing: ['a measurement, such as loss per step'],
    commitFound: true,
  },
  solution: {
    approach: 'Walk the grid once. Each time you meet unvisited land, count one island and flood-fill everything connected to it so it is never counted again.',
    pseudocode: ['count = 0', 'for each cell', '  if land and not seen', '    count += 1', '    flood from cell, marking seen', 'return count'],
    complexity: 'O(R · C) time · O(R · C) space',
    quiz: [
      { q: 'What does the flood fill guarantee?', a: 'each island counted once' },
      { q: 'How many times is each cell visited?', a: 'once' },
      { q: 'Which neighbours does the flood use?', a: 'the four sides' },
    ],
  },
  suggest_slide: {
    slide: [{ id: 'p200', reason: 'Slid least so far and not part of a watch-build pair.' }],
    keep: [{ id: 'd-method', reason: 'The Sunday design stays.' }],
  },
  classify: {
    title: 'Longest Substring Without Repeating Characters',
    pattern: 'SLIDING WINDOW',
    difficulty: 'M',
    source: 'LeetCode',
    note: 'Suggested SLIDING WINDOW · M: one window, grow and shrink.',
    approaches: [
      { name: 'Brute force', pattern: null, complexity: 'O(n³)' },
      { name: 'Sliding window', pattern: 'SLIDING WINDOW', complexity: 'O(n)', best: true },
    ],
  },
  brief: BRIEF_EXAMPLE,
  check: CHECK_EXAMPLE,
  review_sprint: REVIEW_EXAMPLE,
}

export const GRADE_EXPLANATION_EXAMPLE: JobOutput<'grade'> = {
  score: 3, max: 5, passed: true,
  feedback: ['You name the backward pass as the chain rule applied one node at a time.', 'The worked number makes the gradient concrete.'],
  missing: ['why the gradients of a value used twice are added'],
}

export const INTERVIEW_FINAL_EXAMPLE: InterviewFinal = {
  done: true,
  score: 13,
  perItem: [
    { item: 'Requirements and numbers', points: 3, note: 'Gave rps and latency but no burst size.' },
    { item: 'API and data model', points: 2, note: 'Key per user, no TTL.' },
    { item: 'High-level design that meets the numbers', points: 3, note: 'Gateway plus shared store meets the target.' },
    { item: 'Two deep dives with real trade-offs', points: 3, note: 'Bucket vs log argued with numbers; hot keys hand-waved.' },
    { item: 'Failure modes and operations', points: 2, note: 'Fail-open named, no alerting.' },
  ],
  oneThingToStudy: 'How a sliding window counter trades memory for accuracy.',
  deepDives: [2, 1, 1, 0],
  lenses: { load: 2, data: 1, consistency: 1, failure: 1, latency: 1, cost: 0, evolution: 0 },
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const line = (label: string, v: unknown): string | null => (str(v) ? `${label}: ${str(v)}` : null)
const numbered = (label: string, items: string[]): string | null =>
  items.length ? `${label}:\n${items.map((x, i) => `  ${i + 1}. ${x}`).join('\n')}` : null
const clip = (s: string, max = TRANSCRIPT_TEXT_MAX): string => (s.length > max ? `${s.slice(0, max)}…` : s)

/** M1: fences a learner-supplied field so the model reads it as data, never instructions (paired
 * with the guardrail line in guardrails.ts) - the tag is stripped from the content first, so a
 * learner can't smuggle in a fake closing fence. */
const FENCE_TAG = 'LEARNER_TEXT'
const fenceLearnerText = (s: string): string => `<<<${FENCE_TAG} ${s.split(FENCE_TAG).join('')} ${FENCE_TAG}>>>`
/** A `line()` for text the learner typed directly: clipped to `max`, then fenced. */
const learnerLine = (label: string, v: unknown, max = TRANSCRIPT_TEXT_MAX): string | null => {
  const s = str(v)
  return s ? `${label}: ${fenceLearnerText(clip(s, max))}` : null
}

export function clipTranscript(messages: readonly TranscriptMessage[]): TranscriptMessage[] {
  return messages.map(m => ({ from: m.from, text: clip(m.text) }))
}

export function interviewTurnPlan(turn: number, deepDives: readonly string[]): string {
  const dive = (i: number) => `deep dive ${i} ("${deepDives[i - 1] ?? ''}")`
  if (turn <= 0) return 'THIS TURN (0): restate the problem in two lines, then ask the candidate for functional and non-functional requirements.'
  if (turn >= 9) return `THIS TURN (${turn}): the interview is over. Thank the candidate in one line. Ask nothing. Reply in the usual shape, {"say": <your one line>, "done": false}: this is NOT the grade, and "done" stays false.`
  if (turn % 2 === 1) return `THIS TURN (${turn}): ask ${dive((turn + 1) / 2)}. One question.`
  return `THIS TURN (${turn}): push back once on the candidate's last answer to ${dive(turn / 2)}: name its weakest point and ask one follow-up.`
}

function transcriptBlock(c: Obj): string {
  const msgs = Array.isArray(c.transcript) ? c.transcript.filter(isObj) : []
  if (msgs.length) {
    return `Transcript so far (oldest first):\n${msgs.map(m => `  ${m.from === 'interviewer' ? 'Interviewer' : 'Candidate'}: ${fenceLearnerText(clip(str(m.text)))}`).join('\n')}`
  }
  const answers = strs(c.answers)
  return answers.length
    ? `Candidate answers so far (oldest first):\n${answers.map((a, i) => `  ${i + 1}. ${fenceLearnerText(clip(a))}`).join('\n')}`
    : 'Transcript so far: empty (this is the first turn).'
}

function slideRows(v: unknown): string[] {
  return (Array.isArray(v) ? v.filter(isObj) : []).map(t =>
    `${str(t.id)} · ${str(t.title)} · ${str(t.track)} · ${str(t.estMin)} min · ${str(t.difficulty) || '-'} · slid ${str(t.slidCount) || '0'}×`)
}

function refRows(v: unknown): string[] {
  return (Array.isArray(v) ? v.filter(isObj) : []).map(l => `${str(l.label)} ${str(l.url)}`.trim())
}

function pictureBlock(v: unknown): string | null {
  if (!isObj(v)) return null
  const code = strs(v.code)
  return `The picture the learner paid for: ${str(v.title)}${code.length ? `\n  Its code lines:\n${code.map(c => `    ${c}`).join('\n')}` : ''}`
}

function checkBlocks(v: unknown): string[] {
  return (Array.isArray(v) ? v.filter(isObj) : []).map((q, i) => {
    const head = `Question ${i + 1} (id ${str(q.id)}, ${str(q.kind)}): ${str(q.q)}`
    if (q.kind === 'mcq') {
      const ch = strs(q.choices)
      const pick = typeof q.choice === 'number' ? ch[q.choice] ?? `#${q.choice}` : '(no choice)'
      return `${head}\n  Choices: ${ch.map((c, k) => `${k}=${c}`).join(' | ')}\n  Correct index: ${str(q.correct)}\n  Chosen index: ${str(q.choice) || '-'} (${pick})`
    }
    const ideas = strs(q.keyIdeas)
    return `${head}${ideas.length ? `\n  Key ideas: ${ideas.join('; ')}` : ''}\n  Answer: ${fenceLearnerText(clip(str(q.answer), ATTEMPT_LOG_MAX))}`
  })
}

const pct = (v: unknown) => (typeof v === 'number' ? `${Math.round(v * 100)}%` : 'no data')
function reviewLines(v: unknown): (string | null)[] {
  const s = isObj(v) ? v : {}
  const slipped = (Array.isArray(s.slipped) ? s.slipped.filter(isObj) : []).map(x => `${str(x.title)} (rolled ${str(x.rolled)}×)`)
  return [
    line('Sprint', s.sprint), line('Planned', s.planned), line('Done', s.done),
    `Days with focus time: ${strs(s.focusDays).join(', ') || 'none'}`, line('Longest streak (days)', s.longestStreak),
    `Gaps: ${strs(s.gaps).join(', ') || 'none'}`, `Slipped cards: ${slipped.join('; ') || 'none'}`,
    `Redo pass rate: ${pct(s.redoPassRate)}`, `Learning-check pass rate: ${pct(s.checkPassRate)}`,
  ]
}

function taskOf(job: JobName, title: string, c: Obj = {}): string {
  switch (job) {
    case 'hint': return `Give the stuck learner ONE nudge. ${PROMPT_CORE.hint}`
    case 'picture': return `${PROMPT_CORE.picture}\n\n${ATLAS_PICTURE_PROMPT}`
    case 'diagram': return (PROMPT_CORE.diagram ?? '').replace('<title>', title || 'this system')
    case 'interview': return 'You are the interviewer in a 45-minute system design interview. Follow THIS TURN exactly.'
    case 'grade':
      if (c.deliverableKind === 'explanation') {
        return "Grade the learner's written teach-back: an explanation, in their own words, of one stage of the forge capstone. Judge the prose against the rubric and the stage named in the context. There is no code, repository or commit here, so never ask for a diff, a test or a measurement."
      }
      return "Grade the learner's proof artifact against the rubric, using only the note, the commit summary and the read-only git evidence."
    case 'solution': return 'The learner gave up. Explain the solution so they can rebuild it from memory tomorrow.'
    case 'suggest_slide': return 'The sprint is overloaded. Choose which due tickets to slide to the next sprint.'
    case 'classify': return "Classify this problem for the learner's own bank."
    case 'brief':
      return `Write the card brief for the learner's next work session: exactly what to do, in what order, where to go, what they will learn, what "done" looks like and what to hand in. Be concrete and short; the learner is a strong engineer reading this at the start of a session. If the material clearly takes more than 90 minutes, propose a split into sessions of 45 to 90 minutes. For a forge ticket never write, sketch or paste code: the deliverable is "${FORGE_TYPED_BY_HAND}" (a teach-back card hands in an explanation in the learner's own words instead).`
    case 'check': return "Grade the learner's answers to the check questions for this card, one verdict per question, using the key ideas. Be fair and specific."
    case 'review_sprint': return 'Write the sprint review note. The numbers below were computed by the app: quote them, never recompute them.'
  }
}

function contextLines(job: JobName, t: Obj | null, c: Obj): string[] {
  const title = line('Title', t?.title)
  const statement = line('Statement', t?.text)
  const attempt = learnerLine("Learner's attempt log", c.attemptLog, ATTEMPT_LOG_MAX)
  const out: (string | null)[] = []
  switch (job) {
    case 'hint':
      out.push(title, statement, line('Level', c.level), c.level === 2 ? line('Pattern (you may name it)', t?.pattern) : null, attempt)
      break
    case 'picture':
      out.push(title, statement, line('Pattern', t?.pattern), attempt, line('Language for the code lines', c.language ?? 'python'))
      break
    case 'diagram':
      out.push(title, numbered('Deep dives', strs(c.deepDives)), numbered('References', refRows(c.refs)))
      break
    case 'interview':
      out.push(
        title, numbered('Deep dives', strs(c.deepDives)), line('Turn', c.turn),
        c.final === true ? 'FINAL: grade the whole interview now.' : interviewTurnPlan(Number(c.turn) || 0, strs(c.deepDives)),
        transcriptBlock(c),
      )
      break
    case 'grade': {
      const stage = str(c.stage) ? `${str(c.stage)}${str(c.stageTitle) ? ` · ${str(c.stageTitle)}` : ''}` : ''
      if (c.deliverableKind === 'explanation') {
        out.push(line('Teach-back card', t?.title), line('Stage', stage), learnerLine("The learner's written explanation", c.proofNote, PROOF_NOTE_MAX), line('Stage rubric', c.rubric))
        break
      }
      out.push(
        line('Artifact', t?.title), line('Stage', stage), learnerLine('Proof note', c.proofNote, PROOF_NOTE_MAX), line('Repo URL', c.repoUrl),
        line('Commit', c.commit), line('Commit summary', c.commitSummary), line('Rubric', c.rubric),
      )
      break
    }
    case 'solution':
      out.push(title, statement, line('Pattern', t?.pattern), attempt, pictureBlock(c.picture))
      break
    case 'suggest_slide':
      out.push(numbered('Due tickets (id · title · track · minutes · difficulty · times slid)', slideRows(c.tickets)), line('Count to slide', c.count), line('Pace (tickets per sprint)', c.pace), numbered('Next sprint', slideRows(c.nextSprint)))
      break
    case 'classify':
      out.push(learnerLine('Input', c.input, CLASSIFY_INPUT_MAX))
      break
    case 'brief':
      out.push(
        title, statement, line('Ticket kind', c.kind), line('Sprint', c.sprint), line('Current estimate (minutes)', c.estMin),
        line('Forge ticket', c.forge === true ? 'yes' : 'no'), line('Learning card (watch, read, or a stage session of watch)', c.learning === true ? 'yes' : 'no'), line('Teach-back card (a stage session of teachback)', c.teachback === true ? 'yes' : 'no'), line('Stage', c.stage), line('Session', c.session),
        numbered('Links already on the ticket', refRows(t?.links)),
        'Day types: focus (Mon-Wed deep work) · light (Thu-Fri, tired day) · long (Sat-Sun).',
      )
      break
    case 'check':
      out.push(title, ...checkBlocks(c.questions))
      break
    case 'review_sprint':
      out.push(...reviewLines(c.stats))
      break
  }
  return out.filter((x): x is string => x !== null)
}

/** The user prompt the helper pipes to `claude -p` for one job (integration spec §2.2). */
export function jobPrompt(job: JobName, req: { ticket: unknown; context: unknown }, evidence = ''): string {
  const t = isObj(req.ticket) ? req.ticket : null
  const c = isObj(req.context) ? req.context : {}
  const final = job === 'interview' && c.final === true
  const explanation = job === 'grade' && c.deliverableKind === 'explanation'
  const parts = [`Dojo job: ${job}.`, taskOf(job, str(t?.title), c), `CONTEXT\n${contextLines(job, t, c).join('\n') || '(none)'}`]
  if (evidence) parts.push(`Read-only evidence from the learner's repository (git output):\n${evidence}`)
  parts.push(`OUTPUT SCHEMA (${job})\n${final ? INTERVIEW_FINAL_SCHEMA : explanation ? GRADE_EXPLANATION_SCHEMA : OUTPUT_SCHEMAS[job]}`)
  parts.push(`EXAMPLE (shape only; answer for THIS request)\n${JSON.stringify(final ? INTERVIEW_FINAL_EXAMPLE : explanation ? GRADE_EXPLANATION_EXAMPLE : OUTPUT_EXAMPLES[job])}`)
  parts.push(`Reply with exactly one JSON object that matches OUTPUT SCHEMA (${job}). No prose, no Markdown fences.`)
  return parts.join('\n\n')
}
