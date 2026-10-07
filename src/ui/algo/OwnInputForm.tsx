import { useId, useState, type FormEvent } from 'react'
import { walkDef } from '../../content/atlas'
import { INPUT_DEFAULTS, INPUT_FIELDS } from '../../content/libraryInputs'
import { parseOwnInput } from '../../rules/ownInput'
import { Button } from '../primitives'

/**
 * Own input (labs contract §4.6): the typed form for one runnable walkthrough. Trace hands back the raw
 * text and the parsed input; an invalid input re-runs nothing, flags the field and shows the exact message.
 */
export function OwnInputForm({
  walkKey, title, initial, onTrace, onReset,
}: {
  walkKey: string
  title: string
  initial: Record<string, string>
  onTrace: (raw: Record<string, string>) => void
  onReset: () => void
}) {
  const kind = walkDef(walkKey)?.input
  const [raw, setRaw] = useState<Record<string, string>>(initial)
  const [error, setError] = useState<{ field: string; message: string } | null>(null)
  const id = useId()
  if (!kind) return null

  function submit(e: FormEvent) {
    e.preventDefault()
    const r = parseOwnInput(walkKey, raw)
    if (!r.ok) {
      setError({ field: r.field, message: r.error })
      return
    }
    setError(null)
    onTrace(raw)
  }

  return (
    <form className="lab-own-input" aria-label={`Own input: ${title}`} data-testid="lab-own-input" onSubmit={submit} noValidate>
      {INPUT_FIELDS[kind].map(f => {
        const props = {
          id: `${id}-${f.name}`,
          value: raw[f.name] ?? '',
          'aria-invalid': error?.field === f.name ? ('true' as const) : undefined,
          spellCheck: false,
          onChange: (e: { target: { value: string } }) => setRaw({ ...raw, [f.name]: e.target.value }),
        }
        return (
          <div key={f.name} className="lab-field">
            <label htmlFor={`${id}-${f.name}`}>{f.label}</label>
            {f.multiline || f.name === 'edges' ? <textarea rows={f.multiline ? 5 : 2} {...props} /> : <input type="text" {...props} />}
          </div>
        )
      })}
      {error && <p className="lab-own-input-error" role="alert" data-testid="lab-own-input-error">{error.message}</p>}
      <div className="lab-own-input-actions">
        <Button type="submit" variant="accent">Trace</Button>
        <Button
          onClick={() => {
            setRaw({ ...INPUT_DEFAULTS[walkKey] })
            setError(null)
            onReset()
          }}
        >
          Reset to default
        </Button>
      </div>
    </form>
  )
}
