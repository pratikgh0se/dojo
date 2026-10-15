import { Link } from 'react-router-dom'
import { DESTINATIONS, type DestinationId, type NavGroup } from '../../rules/nav'
import { Glyph } from '../../ui/Glyph'

type Variant = 'rail' | 'tab' | 'sheet'
const CLASS: Record<Variant, string> = { rail: 'sh-ri', tab: 'sh-tb', sheet: 'sh-sheet-item' }

/**
 * One destination; the rail, the tab bar and the More sheet share it. The accessible name is exactly the destination's name;
 * the Review item's due count (SHELL-13) is its description. A click is a plain router link: the screen switches at once (R18).
 */
export function NavItem({ id, current, badge, variant = 'rail' }: { id: DestinationId; current: DestinationId | null; badge: number; variant?: Variant }) {
  const d = DESTINATIONS.find(x => x.id === id)!
  const counted = d.id === 'review' && badge > 0
  const dueId = `sh-due-${variant}`
  return (
    <Link
      to={d.to} className={`${CLASS[variant]}${current === id ? ' on' : ''}`} data-testid={`shell-nav-${id}`}
      aria-current={current === id ? 'page' : undefined} aria-label={d.label} aria-keyshortcuts={d.key}
      aria-describedby={counted ? dueId : undefined}
    >
      <Glyph name={d.glyph} size={3} />
      <span className="sh-rl">{d.label}</span>
      {counted && <span className="sh-badge mono" data-testid="shell-review-badge" data-count={badge} aria-hidden="true">{badge}</span>}
      {counted && <span id={dueId} className="vh">{badge} due</span>}
      {variant === 'rail' && d.key && <span className="sh-key mono" aria-hidden="true">{d.key}</span>}
    </Link>
  )
}

const ids = (g: NavGroup): DestinationId[] => DESTINATIONS.filter(d => d.group === g).map(d => d.id)

/**
 * The rail (NAV-01 to NAV-08): six main destinations, Topics (AI, DSA, Designs), Practice (Banks, Atlas), then the foot:
 * Guide and the toggle, the last two controls. 200 px with labels, or 56 px with the label shown on hover and focus.
 */
export function Rail({ expanded, current, badge, onToggle }: { expanded: boolean; current: DestinationId | null; badge: number; onToggle: () => void }) {
  const item = (id: DestinationId) => <NavItem key={id} id={id} current={current} badge={badge} />
  const name = expanded ? 'Collapse navigation' : 'Expand navigation'
  return (
    <nav className="sh-rail" data-expanded={expanded ? 'true' : 'false'} data-testid="shell-rail" aria-label="Destinations">
      <span className="sh-mark" data-testid="logo-cube" aria-hidden="true" />
      <div className="sh-rg" data-testid="shell-rail-group-main">{ids('main').map(item)}</div>
      <div className="sh-rg" data-testid="shell-rail-group-topics">
        <h2 className="sh-rgt" data-testid="shell-rail-group-title-topics">Topics</h2>
        {ids('topics').map(item)}
      </div>
      <div className="sh-rg" data-testid="shell-rail-group-practice">
        <h2 className="sh-rgt" data-testid="shell-rail-group-title-practice">Practice</h2>
        {ids('practice').map(item)}
      </div>
      <div className="sh-rg sh-rfoot">
        {ids('foot').map(item)}
        <button type="button" className="sh-ri sh-toggle" data-testid="shell-rail-toggle" aria-expanded={expanded} aria-label={name} onClick={onToggle}>
          <Glyph name={expanded ? 'chevronL' : 'chevronR'} size={3} />
          <span className="sh-rl">{name}</span>
        </button>
      </div>
    </nav>
  )
}
