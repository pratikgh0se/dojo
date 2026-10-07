import type { ProseItem, ProseSection, ProseTable } from './types'

export const MENTOR_RULE: ProseItem = {
  lead: 'The one rule.',
  text: 'Nobody mentors a stranger who asks to be mentored. Everybody answers a specific question from someone who has clearly done the work. Mentorship is what a series of those exchanges turns into after a few months. So this section is a system for producing good questions in the right rooms, on a schedule.',
}

export const MENTOR_PROTOCOL: { title: string; body: string; template?: string }[] = [
  {
    title: 'Pick two rooms, not ten',
    body: 'Join everything below, but be active in two: one where you are a learner (GPU MODE, EleutherAI) and one where what you already know makes you useful (Kubernetes WG Serving, vLLM, llm-d). In the second room you are a contributor from day one, which is the fastest way to be noticed.',
  },
  {
    title: 'Read for two weeks before posting',
    body: 'Learn who answers questions, which channels are for what, and how people phrase things. Save the names of three people whose answers you keep learning from. Those are your candidate mentors. Do not message them yet.',
  },
  {
    title: 'Ask in the 4-part format, under 150 words',
    body: 'Context (one line), what you tried (two lines with the exact error or result), the specific question (one line), and what you will do with the answer. Post in the public channel, never a DM. Example:',
    template:
      'Context: working through makemore part 3, MLP with batchnorm, on a laptop.\nTried: my training loss plateaus at 2.4 where the video reaches 2.1. I checked the\nlearning rate sweep (1e-3 to 1e-1) and confirmed the batchnorm running mean updates.\nQuestion: is it expected that removing the bias before batchnorm changes the plateau,\nor does that point to a bug in my backward pass?\nWill do: rerun with the fix and post the loss curves back here.',
  },
  {
    title: 'Always close the loop',
    body: 'When the answer works, reply with what happened and a screenshot or loss curve. This is the step almost nobody does, and it is the entire reason people remember you. It also makes your thread useful to the next learner, which the community values.',
  },
  {
    title: 'Answer one question a week',
    body: 'From month 2 you know more than someone in month 1. Answer their question. From month 6, answer infra questions in the ML rooms: how to run this on Kubernetes, why NCCL hangs, how to read the GPU metrics. Infra questions are where researchers are weakest, so a good answer there is a real contribution.',
  },
  {
    title: 'Contribute, then ask the reviewer',
    body: 'Find a "good first issue" in vLLM, SGLang, llm-d, Kueue, KubeRay, torchtitan, or lm-evaluation-harness. Fix it. After the PR merges, ask the reviewer one design question about the area you touched. Three merged PRs in one project makes you a known name to its maintainers, and maintainers of these projects work at the labs you are targeting.',
  },
  {
    title: 'Publish a writeup every month',
    body: 'Each proof of work gets a post: a GitHub README plus a short post on X and LinkedIn with one figure. Tag nothing, ask nothing. Link it when relevant in the rooms. After six posts, people start messaging you.',
  },
  {
    title: 'Cold outreach, month 5 onward, one per month',
    body: 'Only to people whose specific work you have used or reproduced. Reference the exact thing, ask one question your writeup could not settle, and offer something (a reproduction, a bug you found, an infra angle). Never ask for a call in the first message.',
    template:
      'Subject: your torchtitan checkpointing post, one question from a reproduction\n\nHi [name], I reproduced the async checkpoint benchmark from your post on 2 x A100s\n(numbers and code: [link]). I got the 40% step-time reduction you reported, but only\nwhen the checkpoint interval is above 200 steps; below that I see the pattern in the\nattached plot. Is that the expected interaction with the all-gather, or something in my\nsetup? Happy to add it as an issue with a repro if useful.\nThanks, [your name] ([your role], moving toward ML systems)',
  },
  {
    title: 'Apply to the structured programs',
    body: "These are mentorship with a name on it. Their application windows move, so check each quarter: Anthropic Fellows Program, MATS, ARENA, SPAR, BlueDot Impact's AI Safety Fundamentals cohorts, Cohere Labs Scholars, ML Collective, and Google Summer of Code for the open-source projects above. Apply from month 6 with your artifacts; before that your application would be weak.",
  },
  {
    title: 'Keep a mentor log',
    body: 'A simple table in your notes: person, room, what they helped with, date, what you sent back. Reach back out every six to eight weeks with progress, not requests. Two people in that table who reply reliably is a mentor network.',
  },
]

export const MENTOR_LOG: ProseTable = {
  title: 'Mentor log',
  head: ['Person', 'Room', 'Helped with', 'Last contact', 'What I sent back'],
  rows: [['(example) maintainer who reviewed PR #1', 'vLLM Slack', 'scheduler design', '2027-01-10', 'benchmark of the fix']],
}

export const COMMUNITY_BUDGET: ProseSection = {
  title: 'Weekly community budget',
  items: [
    { lead: 'Mon, 20 min:', text: "read the two active rooms, save anything relevant to this week's tasks." },
    { lead: 'Wed, 30 min:', text: "post one question in the 4-part format, or close the loop on last week's." },
    { lead: 'Sun, 40 min:', text: "writeup of the week's work in your notes; on month end, the public post." },
  ],
}

export const PEOPLE: ProseSection = {
  title: 'People worth following now',
  intro: 'Follow to learn how researchers talk about problems. Reply only when you have something specific to add.',
  items: [
    { text: 'Andrej Karpathy (the teaching spine of months 3 and 4)' },
    { text: 'Neel Nanda (interpretability, the most beginner-friendly research entry)' },
    { text: 'Horace He and the PyTorch performance people (GPU MODE regulars)' },
    { text: 'The vLLM, SGLang, and torchtitan maintainers whose names appear on your PRs' },
    { text: "Dwarkesh Patel's interviews for how the labs think, worth keeping in your notes" },
  ],
}
