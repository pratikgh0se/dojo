import { Fragment, type ReactNode } from 'react'
import { WithFileRefs } from './FileRefs'

/**
 * A plan ticket's statement as light formatting: each line is a paragraph, runs of "1." / "-" lines are a list, and `inline code`
 * spans (one or two backticks) are <code> without their backticks; a ``` fence is a code block without its fence lines. A numbered run
 * starts at its first numeral. Nothing else is interpreted (no HTML, no links), and the text
 * reads the same with the markup stripped. File names keep their copy chips (WithFileRefs) in the prose between code spans.
 */
const LIST_LINE = /^\s*(?:(\d{1,2})[.)]|[-*•])\s+(.*)$/
const CODE_SPAN = /(`{1,2})(.+?)\1/g

function inline(text: string): ReactNode {
  const out: ReactNode[] = []
  let last = 0
  let k = 0
  for (const m of text.matchAll(CODE_SPAN)) {
    const at = m.index ?? 0
    if (at > last) out.push(<WithFileRefs key={k++} text={text.slice(last, at)} />)
    out.push(<code key={k++} className="dk-code">{m[2]}</code>)
    last = at + m[0].length
  }
  if (last < text.length) out.push(<WithFileRefs key={k++} text={text.slice(last)} />)
  return <>{out}</>
}

type Block = { kind: 'p'; text: string } | { kind: 'pre'; text: string } | { kind: 'ol'; items: string[]; start: number } | { kind: 'ul'; items: string[] }

export function blocksOf(text: string): Block[] {
  const blocks: Block[] = []
  let fence: string[] | null = null
  for (const line of text.split('\n')) {
    if (fence) {
      if (line.trim().startsWith('```')) { blocks.push({ kind: 'pre', text: fence.join('\n') }); fence = null } else fence.push(line)
      continue
    }
    if (line.trim() === '') continue
    const t = line.trim()
    if (t.startsWith('```')) {
      const rest = t.replace(/^`{3,}/, '')
      if (rest.endsWith('```')) blocks.push({ kind: 'pre', text: rest.replace(/`{3,}$/, '').trim() })
      else fence = []   // a language tag after the opening fence is dropped
      continue
    }
    const li = LIST_LINE.exec(line)
    if (li) {
      const prev = blocks[blocks.length - 1]
      if (li[1]) {
        if (prev && prev.kind === 'ol') prev.items.push(li[2])
        else blocks.push({ kind: 'ol', items: [li[2]], start: Number(li[1]) })
      } else if (prev && prev.kind === 'ul') prev.items.push(li[2])
      else blocks.push({ kind: 'ul', items: [li[2]] })
    } else blocks.push({ kind: 'p', text: t })
  }
  if (fence) blocks.push({ kind: 'pre', text: fence.join('\n') })   // an unclosed fence runs to the end
  return blocks
}

export function StatementText({ text, className = '' }: { text: string; className?: string }) {
  return (
    <section className={`dk-box sr-panel dk-statement ${className}`.trim()} data-testid="ticket-statement" data-content="plan">
      {blocksOf(text).map((b, i) => (
        <Fragment key={i}>
          {b.kind === 'p' && <p className="dk-text">{inline(b.text)}</p>}
          {b.kind === 'pre' && <pre className="dk-pre"><code>{b.text}</code></pre>}
          {b.kind === 'ol' && <ol className="dk-list" start={b.start}>{b.items.map((t, j) => <li key={j}>{inline(t)}</li>)}</ol>}
          {b.kind === 'ul' && <ul className="dk-list">{b.items.map((t, j) => <li key={j}>{inline(t)}</li>)}</ul>}
        </Fragment>
      ))}
    </section>
  )
}
