import type { DesignMode } from './designDigest'

export const DESIGN_MODES: readonly DesignMode[] = ['solo', 'ai-partner', 'human-partner']

/** Any stored value to a mode. The legacy 'interviewer' reads as 'ai-partner'; anything unknown reads as 'solo'. */
export function readDesignMode(raw: unknown): DesignMode {
  if (raw === 'interviewer') return 'ai-partner'
  return (DESIGN_MODES as readonly unknown[]).includes(raw) ? (raw as DesignMode) : 'solo'
}

/** True only for the legacy value S2's migration must rewrite. */
export const needsModeRewrite = (raw: unknown): boolean => raw === 'interviewer'

/** A copy of the row with the legacy mode replaced, or null when there is nothing to do (so a second run writes nothing). */
export function rewriteLegacyMode<T extends { mode: unknown }>(row: T): T | null {
  return needsModeRewrite(row.mode) ? { ...row, mode: 'ai-partner' } : null
}

const LABELS: Record<DesignMode, string> = { solo: 'Solo', 'ai-partner': 'Solo · AI partner', 'human-partner': 'With someone' }
export const modeLabel = (raw: unknown): string => LABELS[readDesignMode(raw)]
