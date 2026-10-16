// Per-job prompt bodies for the real helper (integration spec §2): the job's task, the context it
// needs, the exact OUTPUT SCHEMA and one example reply that passes validateOutput. The system prompt
// (guardrails.ts) is unchanged. Pure: no React, no Dexie, no DOM. The helper gets this through
// server/shared-entry.ts -> server/gen/ai-shared.mjs.
import { ATLAS_PATTERNS } from '../content/patterns'
import { FAKE_DIAGRAM, FAKE_PICTURE_STEPS } from './fake'
import { coachTurn, PHASE_LABEL } from './coachPlan'
import { INTERVIEW_RUBRIC } from './rubric'
import { PROMPT_CORE, SESSION_GRADE_MAX_WORDS, SOLUTION_PSEUDOCODE_MAX_LINES, WORD_LIMITS } from './guardrails'
import { LENSES, NOTE_EVIDENCE_IDS, type InterviewFinal, type JobName, type JobOutput, type TranscriptMessage } from './types'
import {
  BRIEF_LIMITS, DIAGRAM_KINDS, DIAGRAM_MAX_NODES, LINK_KINDS, PACKET_KINDS, PICTURE_LIMITS,
  SRALGO2_OPS, SRALGO2_TYPES, SRALGO_OPS, SRALGO_TYPES, ZONE_KINDS,
} from './validate'

export const TRANSCRIPT_TEXT_MAX = 2000
/** M1: caps on the other free-text fields a learner types directly into a job's context. */
export const ATTEMPT_LOG_MAX = 2000
export const PROOF_NOTE_MAX = 2000
export const CLASSIFY_INPUT_MAX = 4000

// INTERVIEW_RUBRIC lives in ./rubric (the entry chunk reads it without pulling in these prompts, the fake provider and the validators)
export { INTERVIEW_RUBRIC }

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
1. say is at most ${WORD_LIMITS.interview} words, spoken to the learner, doing exactly what THIS TURN says.
2. Ask exactly one question and end with its question mark. Never offer options or examples of answers, never answer your own question and never give the design away.`,
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
  classify: `{ "title": string, "pattern": <label>, "difficulty": "E" | "M" | "H", "source": string, "note": string, "approaches": [ { "name": string, "pattern": <label> | null, "complexity": string, "best"?: true } ] }
1. pattern is exactly one of these 36 labels: ${ATLAS_PATTERNS.join(' | ')}.
2. difficulty is E, M or H.
3. source: "LeetCode" for a leetcode.com URL, "Codeforces" for a codeforces.com URL, else "Text".
4. note: one line, "Suggested <PATTERN> · <E|M|H>" and at most 8 more words.
5. approaches: 2 to 4 ways to solve it, brute force first and the best last; each name at most 4 words; exactly one has "best": true; never include libraryKey.`,
  brief: `{ "goal": string, "steps": [ { "text": string, "url"?: string } ], "minutes": integer, "dayType": "focus" | "light" | "long", "learn": string[], "outcome": string, "deliverable": { "kind": "answers" | "code" | "artifact" | "note" | "explanation", "prompt": string }, "questions": [ { "id": string, "kind": "open" | "mcq", "q": string, "choices"?: string[], "keyIdeas"?: string[], "correct"?: integer } ] }
1. goal: one sentence, what the learner will be able to do. outcome: what "done" looks like, in one sentence.
2. steps: 1 to ${BRIEF_LIMITS.steps} exact, ordered actions, each starting with a verb. url only when you are sure the link is real (http or https); prefer the links given in the context.
3. minutes: an honest estimate from ${BRIEF_LIMITS.minMinutes} to ${BRIEF_LIMITS.maxMinutes}; sum video lengths and allow time for the deliverable. dayType: "focus" for deep work, "light" for reading or review that fits a tired day, "long" for a weekend build.
4. learn: 1 to 4 short phrases naming what the learner will learn.
5. deliverable.kind: "answers" for a video or a reading (then give 2 to 5 questions), "code" for something built, "artifact" for a diagram or a written piece, "note" for a short write-up, "explanation" for an explain-it-simply answer. deliverable.prompt says exactly what to hand in.
6. questions: open questions carry keyIdeas (2 to 4 phrases a good answer touches). An mcq has 3 to 4 choices and "correct", the zero-based index of the right one. Use unique ids q1, q2, ...
7. A learning card (see the context) always has deliverable.kind "answers" with 2 to 5 questions, whatever else it involves.`,
  bank_more: `{ "questions": [ { "type": "concept" | "estimate" | "tradeoff" | "design", "difficulty": integer 1-5, "question": string, "answer": string, "checklist": string[] } ] }
1. Exactly 5 questions, none repeating a question already listed in the context, and no two alike.
2. type: concept (an idea explained), estimate (a number worked out), tradeoff (two options compared) or design (a small system sketched). Use at least three different types and at least two different difficulties.
3. difficulty: 1 (easy recall) to 5 (hard, several steps).
4. question: one clear question the learner answers in their own words, at most 40 words.
5. answer: the model answer, at most 120 words, plain prose.
6. checklist: 1 to 6 short items, each one thing a good answer includes.
7. No other fields: never add id, source, area or node. Never use the word "interview".`,
  check: `{ "results": [ { "id": string, "verdict": "pass" | "partial" | "fail", "correction": string, "pointer": string } ] }
1. One result per question, in the same order, with the question's id.
2. Open question: "pass" when the answer touches the key ideas in its own words, "partial" when it is on the right track but misses one, "fail" otherwise. Judge the idea, not the wording.
3. MCQ: "pass" only when the chosen index equals correct, else "fail".
4. correction: "" on a pass; otherwise one short sentence saying what to fix. Never write code.
5. pointer: "" on a pass; otherwise where to look, such as "Step 2" or the name of the section to revisit.`,
  lab_review: `{ "items": [ { "id": string, "score": integer 0-3, "evidence": [ { "quote": string, "file": string, "line": integer } ], "stronger": string } ], "summary": string }
1. One item per rubric item in the context: every rubric id exactly once, in the same order.
2. score: 0 absent or wrong · 1 attempted but weak or incomplete · 2 solid with a gap · 3 fully meets the item. Judge only the work in the context (WRITEUP.md and the diffs), together with the check results.
3. evidence: for a score of 2 or 3, one to three quotes. A quote is copied exactly, character for character, from ONE line of WRITEUP.md or of a diff (leave out the leading +, - or space that marks a diff line). It is at most 300 characters and may be just part of that line, so a long line still gives a quote. file is the path of that file (WRITEUP.md or the path shown for the diff) and line is its line number in the file. A quote that is not in the work, is longer than 300 characters, or has no file or line is thrown away and the score is lowered. For a score of 0 or 1, evidence may be [].
4. stronger: one or two sentences, at most 60 words, saying what a stronger version of THIS item does. Describe behaviour; never write code or the answer for the learner.
5. summary: at most 80 words about the work as a whole.
6. Do not write a percent or a pass/fail verdict: the app works those out from the scores.`,
  portfolio_draft: `{ "text": string }
1. text is the draft itself and nothing else: no preface, no "Here is".
2. kind "article": Markdown, 350 to 600 words, first person, plain words. Start with one "# " title line, then short sections (what I set out to do, how it works, what the numbers say, what I would change). No code blocks.
3. kind "linkedin": plain text, at most 1300 characters, no Markdown, no emoji, at most 3 hashtags at the end. First person, one idea, one number.
4. Use only facts and numbers that appear in the context. Never invent a result, a user, a company, a date or a claim about scale. Say what was measured and on what.
5. Never mention the learner's employer, job, name or location.
6. The write-up and the journal lines are the learner's words: keep their meaning and voice, do not copy long passages.`,
}

export const INTERVIEW_FINAL_SCHEMA = `{ "done": true, "score": integer 0-20, "perItem": [ { "item": string, "points": integer, "note": string, "feedback": string, "evidence": [ { "source": "notes" | "diagram", "target": string } ] } ], "oneThingToStudy": string, "deepDives": [0|1|2, 0|1|2, 0|1|2, 0|1|2], "lenses": { ${LENSES.map(l => `"${l}": 0|1|2`).join(', ')} }, "inconsistencies"?: string[], "stronger"?: string[], "missed"?: [ { "topic": string, "question": string, "answer": string } ] }
1. perItem has exactly these five items, in this order, points from 0 to the maximum: ${INTERVIEW_RUBRIC.map(r => `${r.item} (max ${r.max})`).join(' · ')}.
2. score is the sum of the perItem points.
3. deepDives scores the four deep dives in order: 0 blank, 1 hand-wave, 2 trade-off with a number or a failure mode.
4. lenses scores all seven lenses on the whole transcript, 0/1/2.
5. note: one sentence per item. oneThingToStudy: one concrete topic.
6. Read the chat answers, the notes and the diagram together. A point made in the notes counts as much as one made in the chat; a box on the diagram counts only when something says what it does.
7. Check the notes against the diagram: estimates against components (for example 20,000 requests a second against one unreplicated database), data-model tables against the drawn stores, the API against the drawn path, non-functional targets against failure handling. Show the arithmetic.
8. inconsistencies: at most 5 sentences, each naming the two places that disagree; [] when there are none. Reflect each finding in the notes of "Requirements and numbers" and "High-level design that meets the numbers". A finding is a flag to check, never a score on its own: score the work.
9. stronger: 2 to 4 sentences on what a stronger version of THIS design does. Describe behaviour; never write the design for the learner.
10. feedback: a paragraph of at most 60 words per item that names concrete things from the learner's notes and diagram (a number they wrote, a box they drew, a missing call) and says what to do about it. note stays the one-sentence version.
11. evidence: at most 3 per item, the places feedback leans on. {"source":"notes","target":"<section id>"} with the id one of ${NOTE_EVIDENCE_IDS.join(' | ')}; {"source":"diagram","target":"<label>"} with the label of a box, sticky note, frame or table copied exactly as it appears in the DIAGRAM or CANVAS NOTES section. Cite nothing you did not read there.
12. missed: at most 3 weak spots worth reviewing, [] when there are none. topic: at most 5 words. question: at most 25 words, answerable from memory in a few lines. answer: at most 60 words, what a strong answer says. Ask about the idea the learner missed, never about their own design.
13. Word budget: the word limits in the system rules (80 for a turn, 150 for an artifact grade's feedback) do not apply to this final grade. Keep the whole answer to at most ${SESSION_GRADE_MAX_WORDS} words, counting every note, feedback, oneThingToStudy, inconsistencies item, stronger item and missed field.`

const BANK_MORE_EXAMPLE: JobOutput<'bank_more'> = {
  questions: [
    { type: 'concept', difficulty: 2, question: 'What does a cache-aside read do on a miss?', answer: 'It reads the value from the database, writes it into the cache with a time to live, then returns it. The next read for that key is served from the cache.', checklist: ['Reads the database on a miss', 'Fills the cache', 'Sets a time to live'] },
    { type: 'estimate', difficulty: 3, question: 'About how much memory holds one million cached user profiles of 2 KB each?', answer: 'One million times 2 KB is about 2 GB, plus 20 to 30 percent overhead for keys and pointers, so plan for roughly 2.5 GB.', checklist: ['Multiplies count by size', 'Adds overhead', 'States the result in GB'] },
    { type: 'tradeoff', difficulty: 3, question: 'Write-through or write-back: which would you choose for a shopping cart, and why?', answer: 'Write-through keeps the database current at the cost of slower writes; write-back is faster but can lose recent writes if the cache node dies. A cart can be rebuilt but orders cannot, so write-through is the safer default.', checklist: ['Names both policies', 'States the cost of each', 'Chooses with a reason'] },
    { type: 'design', difficulty: 4, question: 'Design the cache layer for a read-heavy product page, 20,000 reads a second.', answer: 'Put a cache cluster in front of the database with consistent hashing, a time to live per key, and request coalescing so one miss triggers one database read. Watch the hit rate and plan for a cold start.', checklist: ['Cache in front of the database', 'Key sharding', 'Handles a stampede', 'Watches the hit rate'] },
    { type: 'concept', difficulty: 1, question: 'What is a cache stampede?', answer: 'Many requests miss the same expired key at once and all hit the database together. Locks, early refresh or coalescing prevent it.', checklist: ['Many misses at once', 'Database overload', 'One mitigation'] },
  ],
}
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

const LAB_REVIEW_EXAMPLE: JobOutput<'lab_review'> = {
  items: [
    { id: 'problem', score: 3, evidence: [{ quote: 'The first check needed one small answer.', file: 'WRITEUP.md', line: 4 }], stronger: 'States the problem and the measured goal in one sentence, with the number it is judged by.' },
    { id: 'approach', score: 1, evidence: [], stronger: 'Explains why this approach was chosen over the obvious alternative, and what it costs.' },
  ],
  summary: 'The checks pass and the write-up states the problem clearly. The approach section says what was done but not why.',
}

const PORTFOLIO_DRAFT_EXAMPLE: JobOutput<'portfolio_draft'> = {
  text: '# What a token simulator taught me about queues\n\nI built a small simulator to see where tail latency comes from. The knee in the curve was earlier than I expected, and the cause was the queue, not the model.\n\n## What the numbers say\n\nAt 40 requests per second the p99 doubled.',
}

export const OUTPUT_EXAMPLES: { [J in JobName]: JobOutput<J> } = {
  portfolio_draft: PORTFOLIO_DRAFT_EXAMPLE,
  bank_more: BANK_MORE_EXAMPLE,
  lab_review: LAB_REVIEW_EXAMPLE,
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
}

export const INTERVIEW_FINAL_EXAMPLE: InterviewFinal = {
  done: true,
  score: 13,
  perItem: [
    {
      item: 'Requirements and numbers', points: 3, note: 'Gave rps and latency but no burst size.',
      feedback: 'You gave 20,000 requests a second and a 50 ms budget before drawing anything, which is a strong start. You never say how large a burst is or how long it lasts, so the gateway cannot be sized. Add a burst figure and say what happens above it.',
      evidence: [{ source: 'notes', target: 'requirements' }, { source: 'notes', target: 'assumptions' }],
    },
    {
      item: 'API and data model', points: 2, note: 'Key per user, no TTL.',
      feedback: 'The counter is keyed per user, but nothing says when a key expires, so the store grows without bound. The API lists a check call and no way to read a remaining quota. State a TTL and say who reads the remaining count.',
      evidence: [{ source: 'notes', target: 'api' }, { source: 'notes', target: 'data-model' }, { source: 'diagram', target: 'Counter store' }],
    },
    {
      item: 'High-level design that meets the numbers', points: 3, note: 'Gateway plus shared store meets the target.',
      feedback: 'Gateway in front of a shared counter store meets the latency target on paper. The store is drawn once, so 20,000 requests a second all land on one node. Show how many shards the rate calls for.',
      evidence: [{ source: 'diagram', target: 'Gateway' }, { source: 'diagram', target: 'Counter store' }],
    },
    {
      item: 'Two deep dives with real trade-offs', points: 3, note: 'Bucket vs log argued with numbers; hot keys hand-waved.',
      feedback: 'Token bucket against sliding log is argued with real memory figures, which is the right shape. The hot-key dive stops at "shard it" with no number. Say what one hot user costs a shard and what you do about it.',
      evidence: [{ source: 'notes', target: 'tradeoffs' }],
    },
    {
      item: 'Failure modes and operations', points: 2, note: 'Fail-open named, no alerting.',
      feedback: 'Failing open is named and justified by uptime. Nothing tells an operator that the store is down, so the limiter could be off for hours unnoticed. Add the signal you would page on.',
      evidence: [{ source: 'notes', target: 'open' }, { source: 'diagram', target: 'Gateway' }],
    },
  ],
  oneThingToStudy: 'How a sliding window counter trades memory for accuracy.',
  deepDives: [2, 1, 1, 0],
  lenses: { load: 2, data: 1, consistency: 1, failure: 1, latency: 1, cost: 0, evolution: 0 },
  inconsistencies: ['The notes plan for 20,000 requests a second but the diagram shows one unreplicated Postgres; one node does not sustain that many writes, so the numbers and the design disagree.'],
  stronger: [
    'Names a shard key for the counters and shows how many shards 20,000 requests a second calls for.',
    'Gives every box a line in the notes: its API call, its size and its failure case.',
  ],
  missed: [
    { topic: 'shard key choice', question: 'What makes a good shard key for per-user counters, and what goes wrong with a bad one?', answer: 'It spreads load evenly and keeps one user on one shard. A key with few distinct values, or one hot user, sends most traffic to a single shard.' },
    { topic: 'counter expiry', question: 'Why does a per-user rate counter need an expiry, and how long should it be?', answer: 'Without expiry the store grows with every user ever seen. Expire after one window, so memory tracks active users only.' },
    { topic: 'failing open versus closed', question: 'When a rate limiter loses its store, when do you fail open and when closed?', answer: 'Fail open when blocked users cost more than abuse, and alert at once. Fail closed when the limit protects something that cannot take the extra load.' },
  ],
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

const TURN_TAIL = ' Never offer options, examples of answers or the solution. Write exactly one question and end with a question mark.'

export function interviewTurnPlan(turn: number, deepDives: readonly string[], hint = false): string {
  const t = coachTurn(turn)
  const label = PHASE_LABEL[t.phase]
  if (hint) {
    return `THIS TURN (${turn}) · ${label} · HINT: the learner asked for a hint. Re-ask your last question as ONE sharper, narrower question that points at what to think about next. Do not answer it.${TURN_TAIL}`
  }
  const area = t.dive
    ? `the area "${deepDives[t.dive - 1] ?? ''}" as something to think about; do not quote, list or name any option, technique or product it mentions`
    : t.focus
  if (t.kind === 'open') return `THIS TURN (${turn}) · ${label} · opening: restate the design prompt in two lines, then ask ONE thinking question about ${area}.${TURN_TAIL}`
  if (t.kind === 'challenge') {
    return `THIS TURN (${turn}) · ${label} · discussion: challenge ONE choice the learner has made. Name the choice in a few words, then ask ONE question about ${area}. Do not say it is wrong and do not propose an alternative.${TURN_TAIL}`
  }
  return `THIS TURN (${turn}) · ${label} · question: ask ONE question about ${area}.${TURN_TAIL}`
}

function transcriptBlock(c: Obj): string {
  const msgs = Array.isArray(c.transcript) ? c.transcript.filter(isObj) : []
  if (msgs.length) {
    return `Transcript so far (oldest first):\n${msgs.map(m => `  ${m.from === 'interviewer' ? 'AI partner' : 'Learner'}: ${fenceLearnerText(clip(str(m.text)))}`).join('\n')}`
  }
  const answers = strs(c.answers)
  return answers.length
    ? `Learner answers so far (oldest first):\n${answers.map((a, i) => `  ${i + 1}. ${fenceLearnerText(clip(a))}`).join('\n')}`
    : 'Transcript so far: empty (this is the first turn).'
}

export const DESIGN_TURN_MAX = 3000
export const DESIGN_FINAL_MAX = 8000
function designBlock(c: Obj, final: boolean): string {
  const d = str(c.design)
  return d
    ? `Design so far (the learner's diagram, notes and schema, as written):\n${fenceLearnerText(clip(d, final ? DESIGN_FINAL_MAX : DESIGN_TURN_MAX))}`
    : 'Design so far: nothing written yet.'
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

/** The lab review's context: the rubric, the latest check results, WRITEUP.md and each diff, the learner's text fenced as data. */
function labReviewBlocks(c: Obj): (string | null)[] {
  const bundle = isObj(c.bundle) ? c.bundle : {}
  const rubric = (Array.isArray(bundle.rubric) ? bundle.rubric.filter(isObj) : []).map(r => `${str(r.id)}: ${str(r.text)}`)
  const results = Array.isArray(c.results) ? c.results.filter(isObj).map(r => `${str(r.id)} (${str(r.name)}): ${str(r.status)}${str(r.detail) ? ` - ${str(r.detail)}` : ''}`) : []
  const files = Array.isArray(bundle.files) ? bundle.files.filter(isObj) : []
  const diffs = files.filter(f => typeof f.diff === 'string').map(f => `Diff of ${str(f.path)}:\n${fenceLearnerText(str(f.diff))}`)
  const notes = files.filter(f => typeof f.note === 'string').map(f => `${str(f.path)} (${str(f.note)})`)
  return [
    numbered('Rubric (one item each; reply with exactly these ids)', rubric),
    numbered('Check results of the latest run', results),
    typeof bundle.writeup === 'string' && bundle.writeup.trim() ? `WRITEUP.md:\n${fenceLearnerText(bundle.writeup)}` : 'WRITEUP.md: (empty)',
    ...(diffs.length ? diffs : ['No changed files since the lab was set up.']),
    numbered('Files not shown', notes),
  ]
}

function taskOf(job: JobName, title: string, c: Obj = {}): string {
  switch (job) {
    case 'hint': return `Give the stuck learner ONE nudge. ${PROMPT_CORE.hint}`
    case 'picture': return `${PROMPT_CORE.picture}\n\n${ATLAS_PICTURE_PROMPT}`
    case 'diagram': return (PROMPT_CORE.diagram ?? '').replace('<title>', title || 'this system')
    case 'interview': return 'You are the AI partner, a thinking coach, in a 45-minute system design session. You only ask questions. Follow THIS TURN exactly.'
    case 'grade':
      if (c.sessionGrade === true) return "Grade the learner's whole design session. Read the chat answers, the notes and the diagram together, as one piece of work, against the five-item rubric."
      return "Grade the learner's proof artifact against the rubric, using only the note, the commit summary and the read-only git evidence."
    case 'solution': return 'The learner gave up. Explain the solution so they can rebuild it from memory tomorrow.'
    case 'classify': return "Classify this problem for the learner's own bank."
    case 'brief':
      return `Write the card brief for the learner's next work session: exactly what to do, in what order, where to go, what they will learn, what "done" looks like and what to hand in. Be concrete and short; the learner is a strong engineer reading this at the start of a session.`
    case 'bank_more': return 'Write 5 new practice questions for one skill node of the learner\'s question bank. They are answered from memory, then compared with your model answer and checklist.'
    case 'check': return "Grade the learner's answers to the check questions for this card, one verdict per question, using the key ideas. Be fair and specific."
    case 'portfolio_draft':
      return c.kind === 'linkedin'
        ? 'Draft a short LinkedIn post about a lab the learner built, had reviewed and measured. The learner edits it and posts it by hand.'
        : 'Draft an article about a lab the learner built, had reviewed and measured. The learner edits it before it is published.'
    case 'lab_review': return "Review the learner's finished lab against its rubric, one item at a time, using only the write-up, the diffs and the check results in the context. Be fair and specific, and quote the work as evidence."
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
        title, numbered('Deep dives (topics for you to steer toward; never quote their options)', strs(c.deepDives)), line('Turn', c.turn),
        c.final === true ? 'FINAL: grade the whole session now.' : interviewTurnPlan(Number(c.turn) || 0, strs(c.deepDives), c.hint === true),
        transcriptBlock(c), designBlock(c, c.final === true),
      )
      break
    case 'grade': {
      if (c.sessionGrade === true) {
        out.push(title, numbered('Deep dives', strs(c.deepDives)), 'FINAL: grade the whole session now. Read the chat answers, the notes and the diagram together.', transcriptBlock(c), designBlock(c, true))
        break
      }
      const stage = str(c.stage) ? `${str(c.stage)}${str(c.stageTitle) ? ` · ${str(c.stageTitle)}` : ''}` : ''
      out.push(
        line('Artifact', t?.title), line('Stage', stage), learnerLine('Proof note', c.proofNote, PROOF_NOTE_MAX), line('Repo URL', c.repoUrl),
        line('Commit', c.commit), line('Commit summary', c.commitSummary), line('Rubric', c.rubric),
      )
      break
    }
    case 'solution':
      out.push(title, statement, line('Pattern', t?.pattern), attempt, pictureBlock(c.picture))
      break
    case 'classify':
      out.push(learnerLine('Input', c.input, CLASSIFY_INPUT_MAX))
      break
    case 'brief':
      out.push(
        title, statement, line('Ticket kind', c.kind), line('Current estimate (minutes)', c.estMin),
        line('Learning card (watch or read)', c.learning === true ? 'yes' : 'no'),
        numbered('Links already on the ticket', refRows(t?.links)),
        'Day types: focus (Mon-Wed deep work) · light (Thu-Fri, tired day) · long (Sat-Sun).',
      )
      break
    case 'bank_more':
      out.push(line('Area', c.area), line('Node', `${str(c.node)} · ${str(c.nodeTitle)}`), line('About', c.nodeAbout), numbered('Questions already in this node (do not repeat)', strs(c.avoid)))
      break
    case 'check':
      out.push(title, ...checkBlocks(c.questions))
      break
    case 'lab_review':
      out.push(title, ...labReviewBlocks(c))
      break
    case 'portfolio_draft':
      out.push(
        line('Kind', c.kind), line('Lab', t?.title), learnerLine('Write-up', c.writeup, 8000),
        numbered('Journal lines from the lab', strs(c.journal).map(x => fenceLearnerText(clip(x, 300)))),
        numbered('What a stronger version does (from the review)', strs(c.stronger).map(x => clip(x, 300))),
        str(c.results) ? `Latest passing results:\n${clip(str(c.results), 2000)}` : null,
      )
      break
  }
  return out.filter((x): x is string => x !== null)
}

/** The user prompt the helper pipes to `claude -p` for one job (integration spec §2.2). */
export function jobPrompt(job: JobName, req: { ticket: unknown; context: unknown }, evidence = ''): string {
  const t = isObj(req.ticket) ? req.ticket : null
  const c = isObj(req.context) ? req.context : {}
  const final = (job === 'interview' && c.final === true) || (job === 'grade' && c.sessionGrade === true)
  const parts = [`Dojo job: ${job}.`, taskOf(job, str(t?.title), c), `CONTEXT\n${contextLines(job, t, c).join('\n') || '(none)'}`]
  if (evidence) parts.push(`Read-only evidence from the learner's repository (git output):\n${evidence}`)
  parts.push(`OUTPUT SCHEMA (${job})\n${final ? INTERVIEW_FINAL_SCHEMA : OUTPUT_SCHEMAS[job]}`)
  parts.push(`EXAMPLE (shape only; answer for THIS request)\n${JSON.stringify(final ? INTERVIEW_FINAL_EXAMPLE : OUTPUT_EXAMPLES[job])}`)
  parts.push(`Reply with exactly one JSON object that matches OUTPUT SCHEMA (${job}). No prose, no Markdown fences.`)
  return parts.join('\n\n')
}
