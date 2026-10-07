import type { PlanSchedule } from '../data/types'
import type { ProseSection, ProseTable } from './types'

export const COVERAGE: ProseTable = {
  title: 'What this plan covers, so nothing else needs to',
  head: ['Area', 'Where', 'Depth'],
  rows: [
    ['Math for ML, then forge: one app built by hand', 'AI track, Stage 0 (S1): the black-box lab first, then math by picture', 'Ten derivations by hand; load an inference stack before writing code'],
    ['Models: autograd to your own GPT to training at scale', 'AI track, Stages 1 to 5 (S2–S22): micrograd, makemore, GPT, tokenizer, training at scale', 'Rebuild every mechanism from memory, no reference open'],
    ['Inference server, then AI infra on Kubernetes', 'AI track, Stages 6 to 7 (S23–S38): your own inference server, router and autoscaler', 'Build-then-compare against vLLM, llm-d and KEDA autoscaling on vLLM metrics, multi-LoRA hot-load; two capped rented-GPU sessions in Stage 7'],
    ['Evals harness, fine-tuning, agents', 'AI track, Stages 8 to 10 (S39–S58)', 'Build the eval suite yourself; fine-tune on your own Dojo history; ship the weekly-review agent'],
    ['Research: one continuing project with a writeup', 'AI track, Stage 11 (S59–S72)', 'Hypothesis, real experiments, a writeup for the vault'],
    ['Hard coding: graphs, DP, trees, heaps, backtracking', 'DSA bank, sprints 1 to 12, sweeps to 24, weekly after', '169 problems, 49 hard, timed'],
    ['Design principles, patterns, concurrency, practical coding rounds', 'Interview track, blocks 4 to 5 and 13', 'Implemented, not memorized'],
    ['Hard system design: distributed, data-heavy, ML, LLM and agentic', 'Design bank, sprints 21 to 56; one design every Sunday', '48 designs, four deep dives each, rubric-graded'],
    ['Behavioral stories, portfolio, resume, applications, negotiation', 'Interview track, blocks 12 to 18', 'Story bank from your real work'],
    ['Community, mentors, public writing, open source', 'Every sprint; the mentors tab', 'Two rooms, monthly posts, five merged PRs'],
  ],
}

/** G6: "Why three years" names what the plan protects, from the plan's schedule (`protects`). */
export const rulesOfTheRoad = (s: Pick<PlanSchedule, 'protects'>): ProseSection => ({
  title: 'Rules of the road',
  items: [
    {
      lead: 'One 50-minute block on four weekdays, alternating tracks.',
      text: 'Friday is off. Saturday is a 3-hour AI build block plus the 30-minute news slot. Around 9 hours a week, every week, for three years.',
    },
    { lead: 'Type every line.', text: 'No copying notebooks. AI tools may explain, never write, in the deep block.' },
    {
      lead: 'Every stage ends with a proof of work',
      text: 'in a public GitHub repo with a short writeup. Twelve stage artifacts over three years are your portfolio.',
    },
    { lead: 'Community from sprint 2.', text: 'One question or one answer per sprint in a community. Mentors come from that, not from asking for mentors.' },
    {
      lead: 'Prerequisites are real.',
      text: 'The skill tree locks a node until its parents reach 70%. If nanoGPT does not make sense, the answer is a tier back, not more videos.',
    },
    {
      lead: 'Why three years.',
      text: `The material is about 1,400 hours. At 9 hours a week that is 150 weeks. Compressing it means skipping ${s.protects}, and the plan would not survive month four. Year two ends at a checkpoint where you are interview-ready for ML systems roles; year three adds the research work that makes research-engineering roles realistic.`,
    },
    { lead: 'Miss a sprint, do not restart.', text: 'Slide the start date by two weeks. Never skip ahead, never double up to catch up.' },
  ],
})

export const UNDERSTANDING: ProseSection = {
  title: 'What "understanding everything" means here',
  intro: 'By the end you should be able to, from memory and with no reference open:',
  items: [
    { text: 'Derive backpropagation for a small network and implement it in NumPy.' },
    { text: 'Write a GPT in PyTorch, tokenizer included, and train it on your own laptop.' },
    { text: 'Explain why FlashAttention is faster, and write a simple fused kernel in Triton.' },
    { text: 'Train with DDP at reduced scale, kill a worker, and recover from checkpoint; a rented GPU appears only for two capped sessions in Stage 7.' },
    { text: 'Serve a model with vLLM on Kubernetes and explain paged attention and continuous batching.' },
    { text: 'Read a new paper from any frontier lab and say what is new and what you would test.' },
    { text: 'Run a small experiment of your own with a hypothesis, ablation, and writeup.' },
    { text: 'Solve a medium coding problem in 25 minutes and design a model-serving platform, a streaming pipeline, or an agent orchestration system on a whiteboard in 45.' },
  ],
}

export const OUT_OF_SCOPE: ProseSection = {
  title: 'Deliberately out of scope',
  items: [
    { text: 'Classical ML breadth (SVMs, boosting)' },
    { text: 'computer vision' },
    { text: 'deep reinforcement learning' },
    { text: 'CUDA below Triton' },
    { text: 'competitive-programming tricks' },
  ],
  outro: 'None are needed for the roles you named; any can be a year-four addition.',
}
