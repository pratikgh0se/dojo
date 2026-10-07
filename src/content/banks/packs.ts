import type { BankTabDef, BankTabId } from './meta'
import type { ShippedBank, ShippedBankId } from './types'

/**
 * Optional bank packs. The public build ships none: no third-party problem list is bundled, so the Banks
 * screen shows the Plan bank and Mine (your own entries). Vite aliases `@bank-packs` to another module with
 * this same shape when a private build or the test suite supplies packs (see `vite.config.ts`).
 */
export type LoadedPacks = Readonly<Partial<Record<ShippedBankId, ShippedBank>>>

/** Tabs the packs add, in display order (between the Plan bank and Mine). */
export const PACK_META: readonly BankTabDef[] = []
/** Where Mine looks for a pasted URL after the Plan bank, first hit wins. */
export const PACK_KNOWN_ORDER: readonly BankTabId[] = []
/** A pack item id that is the same ticket as a plan design: pack item id -> plan design id. */
export const PACK_DESIGN_OVERLAP: Readonly<Record<string, string>> = {}

/** Loaded on demand, so a pack's JSON stays out of the main chunk. */
export function loadPacks(): Promise<LoadedPacks> {
  return Promise.resolve({})
}
