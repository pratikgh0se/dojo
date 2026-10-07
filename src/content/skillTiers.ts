export const SKILL_TIERS: readonly string[] = [
  'Math + tools', 'Fundamentals', 'Neural nets', 'Transformers', 'LLM stack', 'Systems', 'Research', 'Loops', 'Apply',
]

export function tierName(tier: number): string {
  return SKILL_TIERS[tier] ?? `Tier ${tier}`
}
