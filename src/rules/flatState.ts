import type { SettingsRow } from '../data/db'
import type {
  AiLogRow, BankExtraRow, BankGradeRow, BankItem, CheckAttemptRow, CodeRow, DesignSession, GradeRow, PictureRow, Pulse, JournalRow, Redo, RungUse, Session, StoredEvent, Ticket,
} from '../data/types'

/** Every table the flat migration reads, and the ones it may write. Pure data: no Dexie. */
export interface FlatState {
  tickets: Ticket[]; sessions: Session[]; redos: Redo[]; rungUses: RungUse[]; checkAttempts: CheckAttemptRow[]; code: CodeRow[]
  grades: GradeRow[]; bankItems: BankItem[]; designSessions: DesignSession[]; events: StoredEvent[]; aiLog: AiLogRow[]; pictures: PictureRow[]
  settings: SettingsRow
  /** R1 F1: the daily AI pulse log. Absent on every image but a fixture that holds one; the flat migration never reads it. */
  pulses?: Pulse[]
  /** R1 W2: the daily journal. Absent on every image but a fixture that holds rows; the flat migration never reads it. */
  journal?: JournalRow[]
  /** R1 W6: question-bank grades and AI-made questions. Absent on every image but a fixture that holds them; the flat migration never reads them. */
  bankGrades?: BankGradeRow[]
  bankExtra?: BankExtraRow[]
}
export const FLAT_TABLES = [
  'tickets', 'sessions', 'redos', 'rungUses', 'checkAttempts', 'code', 'grades', 'bankItems', 'designSessions', 'events', 'aiLog', 'pictures',
] as const
