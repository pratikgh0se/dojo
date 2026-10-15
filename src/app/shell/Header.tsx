import { useTickets } from '../../data/hooks'
import { headerXp, levelOf } from '../../rules/xp'
import { Glyph } from '../../ui/Glyph'
import { SaveStatus } from '../../ui/SaveStatus'
import { GearMenu } from './GearMenu'

const mac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)

/**
 * 48 px: the screen's one heading, the palette trigger, save state, the one level and XP chip, the gear (SHELL-07).
 * `own` says the screen draws its own heading (a ticket, a design session), so the title is plain text; an empty title
 * (a legacy screen, which draws its own h1) leaves none. On a phone the rail's logo mark sits at the header's left.
 */
export function Header({ title, own, phone, onSearch, onShortcuts }: { title: string; own: boolean; phone?: boolean; onSearch: () => void; onShortcuts: () => void }) {
  const tickets = useTickets()
  // useTickets() is undefined until the live query has answered: until then the chips are a neutral placeholder with no
  // data-value (absent, never 0), so a reader polling data-value cannot take a false 0 for the real number.
  const loaded = tickets !== undefined
  const xp = headerXp(tickets ?? [])
  const level = levelOf(xp)
  return (
    <header className="sh-header" data-testid="shell-header">
      {phone && <span className="sh-mark" data-testid="logo-cube" aria-hidden="true" />}
      {title && (own ? <span className="sh-title">{title}</span> : <h1 className="sh-title">{title}</h1>)}
      <button type="button" className="sh-search" data-testid="shell-search" aria-label="Jump to a ticket, skill or setting" onClick={onSearch}>
        <Glyph name="search" size={2} /><span className="sh-stext">Jump to ticket, skill or setting</span><kbd className="sh-kbd">{mac ? '⌘K' : 'Ctrl K'}</kbd>
      </button>
      <SaveStatus />
      <span className="sh-lv">
        <span className="mono sh-lvn" data-testid="level" data-value={loaded ? level : undefined}>LV {loaded ? level : '–'}</span>
        <span className="mono sh-xp" data-testid="xp-total" data-value={loaded ? xp : undefined}>{loaded ? xp : '–'} XP</span>
      </span>
      <GearMenu onShortcuts={onShortcuts} />
    </header>
  )
}
