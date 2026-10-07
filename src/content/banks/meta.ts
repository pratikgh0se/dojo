import type { BankId } from '../../data/types'
import { PACK_DESIGN_OVERLAP, PACK_KNOWN_ORDER, PACK_META } from '@bank-packs'

export type BankTabId = 'plan' | BankId

export interface BankTabDef {
  id: BankTabId
  label: string
  /** exact `href` of the header's `Source ↗` link (C-BANKS §1.1); null on Plan bank and Mine */
  source: string | null
  /** `Snapshot <date>` label; null on Plan bank and Mine */
  snapshot: string | null
}

export const BANK_TABS: readonly BankTabDef[] = [
  { id: 'plan', label: 'Plan bank', source: null, snapshot: null },
  ...PACK_META,
  { id: 'mine', label: 'Mine', source: null, snapshot: null },
]

/** Where Mine looks for a pasted URL, first hit wins (C-BANKS §2 "known items skip classify"). */
export const KNOWN_ITEM_ORDER: readonly BankTabId[] = ['plan', ...PACK_KNOWN_ORDER]

/** C-BANKS §1.4: these Hello Interview items are the same ticket as a plan design. */
export const DESIGN_OVERLAP: Readonly<Record<string, string>> = PACK_DESIGN_OVERLAP
