import type { BankId, Difficulty } from '../../data/types'
import type { AtlasPattern } from '../patterns'

/** 'E' | 'M' | 'H'; a Codeforces rating number; or null (Hello Interview). */
export type ItemDifficulty = Difficulty | number | null

export type ShippedBankId = Exclude<BankId, 'mine'>

/** Exactly the C-BANKS §1 fields. Nothing else is ever shipped. */
export interface ShippedItem {
  id: string
  name: string
  url: string
  difficulty: ItemDifficulty
  pattern: AtlasPattern | null
  group: string
  num?: number
  contestId?: number
  index?: string
}

export interface ShippedBank {
  bank: ShippedBankId
  source: string
  snapshot: string
  fetchedAt: string
  via: string
  groups: string[]
  items: ShippedItem[]
}
