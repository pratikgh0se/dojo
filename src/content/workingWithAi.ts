import type { PromptTemplate, ProseTable } from './types'

export const AGENT_BUCKETS: ProseTable = {
  title: "The rule: type what teaches, generate what doesn't",
  head: ['Bucket', 'What is in it', 'Who writes it'],
  rows: [
    [
      'Core mechanisms (about 30% of hours)',
      'backprop, attention, the training loop, tokenizer, KV cache, FSDP sharding arithmetic, gradient derivations, every interview coding problem, every design on a whiteboard',
      'You. From memory, repeatedly, no agent open. This is the deep block and the interview block.',
    ],
    [
      'Scaffolding (about 50%)',
      'Dojo itself, dotfiles, notes tooling, one-off scripts outside forge/ — plotting, configs, CLIs, dashboards, READMEs for that tooling',
      'The agent drafts, you review every line and can explain it. Speed matters here; understanding is cheap because you already know this world. Never inside forge/: every forge line is typed by hand.',
    ],
    [
      'Frameworks and APIs (about 20%)',
      'Hugging Face, TRL, vLLM, torchtitan, lm-eval-harness, cloud SDKs',
      'Read the source with the agent as a guide. Never memorize; always know the shape and the failure modes.',
    ],
  ],
}

export const TUTOR_PROMPTS: PromptTemplate[] = [
  {
    title: 'For a paper or chapter',
    body: '"Here is [link or text]. Summarize it in 10 bullets a platform engineer would\nunderstand. Then ask me 3 questions to check I got it. Then tell me which\nsingle section I should read myself and why."',
  },
  {
    title: 'For a concept that did not land',
    body: '"Teach me [concept] at three levels: to a 12-year-old, to a backend engineer,\nto an ML engineer. Use one running example. Then quiz me with 3 questions."',
  },
  {
    title: 'For code I typed along',
    body: '"Here is my [file]. Do not fix anything. Ask me one question per function\nabout why it is written that way. If I answer wrong, explain, then re-ask."',
  },
  {
    title: 'After a failed timed problem',
    body: '"I failed [LeetCode number] in 25 minutes. Here is my attempt. Do not give\nthe solution. Tell me which pattern this is and one hint, then let me retry."',
  },
  {
    title: 'For a design deep dive',
    body: '"I am designing [system]. Play the interviewer. Ask me the deep-dive\nquestions one at a time and push on every hand-wave."',
  },
]

export const GPU_BUDGET: ProseTable = {
  title: 'GPU budget: free through Stage 6, capped rented sessions only in Stage 7',
  head: ['Stage work', 'Free path (default)', 'If you decide to spend'],
  rows: [
    ['Setup through the inference server (autograd, makemore, GPT, tokenizer, KV cache, batching, quantization)', 'Your laptop. No GPU needed.', 'Nothing.'],
    [
      'GPT-2-small reproduction at reduced scale',
      'Capped token/step budget on a free tier (Kaggle/Colab T4 or similar); acceptance tests check correctness (loss decreasing, DDP equivalence, checkpoint resume), never final-quality loss.',
      'Nothing required — the top-level $10–20/month budget covers this without a larger run.',
    ],
    [
      'AI infra on Kubernetes, your own router/P-D split/autoscaler plus kind + llm-d-inference-sim (no real GPU)',
      'Laptop and kind. No GPU cost.',
      'Nothing.',
    ],
    [
      'AI infra on Kubernetes, two capped real-GPU sessions (real 2-GPU P/D, then the combined chaos exercise)',
      'Not available free — these two sessions are the only place the plan asks you to rent a GPU.',
      'Two capped rented-GPU sessions, about 1 hour each, $3–8 and $5–10, roughly $20 total.',
    ],
    ['Evals harness, fine-tuning (SFT/LoRA/DPO on your own Dojo history), agents, research', 'Laptop or a free Colab/Kaggle tier. Fits.', 'Nothing.'],
  ],
  note: 'Expected total over three years on the free path: under $100, all optional — only Stage 7’s two rented-GPU sessions (~$20 total) ever cost money. CUDA/Triton stays an optional stretch shelf across Stages 5–9, never required for Built. Every task that could cost money says so in its text.',
}
