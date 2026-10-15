import { Link } from 'react-router-dom'
import { useLeaveDo } from '../../../app/origin'
import { Glyph } from '../../../ui/Glyph'

export function TicketMissing() {
  const leave = useLeaveDo()
  return (
    <div className="dk-missing" data-testid="do-screen">
      <button type="button" className="do-back" data-testid="do-back" onClick={leave}><Glyph name="chevronL" /> Back</button>
      <p className="do-missing">That ticket is not on your path.</p>
      <Link className="sr-btn" to="/path" data-testid="ticket-missing-action">Open Path</Link>
    </div>
  )
}
