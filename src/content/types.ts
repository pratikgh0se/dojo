import type { Link } from '../data/types'

export interface ProseItem {
  /** bold lead-in, rendered before text */
  lead?: string
  text: string
  links?: Link[]
}

export interface ProseSection {
  title: string
  intro?: string
  items: ProseItem[]
  ordered?: boolean
  outro?: string
}

export interface ProseTable {
  title: string
  head: string[]
  rows: string[][]
  note?: string
}

export interface PromptTemplate {
  title: string
  body: string
}
