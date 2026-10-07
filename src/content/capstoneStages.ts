/**
 * The 12 forge capstone stages, 00–11, with the titles and sprint ranges pinned in
 * C-PROJECTS §0 (from the forge capstone spec's Timeline). Index = stage number.
 * Static data: the artifact seed and the cube ladder use these titles, not plan text.
 */
export interface CapstoneStage { stage: number; title: string; from: number; to: number }

export const CAPSTONE_STAGES: readonly CapstoneStage[] = [
  { stage: 0, title: 'Setup + math by picture', from: 1, to: 1 },
  { stage: 1, title: 'micrograd', from: 2, to: 4 },
  { stage: 2, title: 'makemore', from: 5, to: 9 },
  { stage: 3, title: 'GPT', from: 10, to: 14 },
  { stage: 4, title: 'Tokenizer (BPE)', from: 15, to: 16 },
  { stage: 5, title: 'Training at scale', from: 17, to: 22 },
  { stage: 6, title: 'Inference server', from: 23, to: 30 },
  { stage: 7, title: 'AI infra on Kubernetes', from: 31, to: 38 },
  { stage: 8, title: 'Evals harness', from: 39, to: 44 },
  { stage: 9, title: 'Fine-tuning', from: 45, to: 52 },
  { stage: 10, title: 'Agents', from: 53, to: 58 },
  { stage: 11, title: 'Research', from: 59, to: 72 },
]
