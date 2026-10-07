import { AI_ERRORS } from '../../ai/types'
import { Button } from '../primitives'
import './ai.css'
import { copy, DESKTOP } from '../../lib/platform'

export interface AiFailure { code: string; message: string }

// Foundation's AI_ERRORS entries carry {status, message} (no `heading` field, Task 1 finding).
// Every message string is already worded exactly as the C-LADDER §6 heading, so it doubles as one.
const HEADINGS = AI_ERRORS as Record<string, { message: string }>

/** C-LADDER §6; unknown codes read as a generic helper failure. */
export function aiHeading(code: string): string {
  // C-DESKTOP: in the app the helper is part of Dojo itself, so "npm run helper" is not the way out
  if (code === 'helper_unreachable' && DESKTOP) return copy('helperUnreachable')
  return (HEADINGS[code] ?? HEADINGS.claude_failed).message
}

/** A heading's `backticked` words (a command to type, e.g. `claude`) as code. */
function withCode(text: string) {
  return text.split('`').map((part, i) => (i % 2 === 1 ? <code key={i}>{part}</code> : part))
}

/** AI "UI contract": every model call shows a 3-block stepped loader in the panel. */
export function AiLoader() {
  return (
    <div className="ai-loader" role="status" aria-label="Asking the helper…" data-testid="ai-loader">
      <i /><i /><i />
    </div>
  )
}

/**
 * Ruling 20 S7: the codes whose friendly line says all there is to do (sign in, install, start the helper). Their raw
 * detail would only repeat it in CLI words, so it waits behind "Details".
 */
export const KNOWN_AI_CODES: ReadonlySet<string> = new Set(['claude_signed_out', 'claude_missing', 'helper_unreachable'])

/** AI "UI contract": the raw error in Space Mono and a Retry button; nothing else breaks. */
export function AiError({ failure, onRetry }: { failure: AiFailure; onRetry: () => void }) {
  const detail = <code className="ai-error-detail" data-testid="ai-error-detail">{`${failure.code}: ${failure.message}`}</code>
  return (
    <div className="ai-error" role="alert" data-testid="ai-error">
      <p className="ai-error-head">{withCode(aiHeading(failure.code))}</p>
      {KNOWN_AI_CODES.has(failure.code)
        ? <details className="ai-error-more" data-testid="ai-error-more"><summary>Details</summary>{detail}</details>
        : detail}
      <Button data-testid="ai-retry" onClick={onRetry}>Retry</Button>
    </div>
  )
}
