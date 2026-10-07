import type { Link } from '../data/types'
import type { PromptTemplate, ProseItem, ProseSection, ProseTable } from '../content/types'
import { Panel } from './primitives'
import './prose.css'

export function ExtLink({ link, className = 'ext' }: { link: Link; className?: string }) {
  return <a className={className} href={link.url} target="_blank" rel="noopener noreferrer">{link.label} ↗</a>
}

function ExtLinks({ links }: { links?: Link[] }) {
  if (!links?.length) return null
  return (
    <>
      {links.map(l => (
        <span key={l.url}>
          {' '}
          <ExtLink link={l} />
        </span>
      ))}
    </>
  )
}

export function ProseList({ items, ordered = false }: { items: ProseItem[]; ordered?: boolean }) {
  const Tag = ordered ? 'ol' : 'ul'
  return (
    <Tag className="prose-list">
      {items.map((it, i) => (
        <li key={i}>
          {it.lead && <b>{it.lead}</b>}
          {it.lead && !/^[,.;:]/.test(it.text) ? ' ' : ''}
          {it.text}
          <ExtLinks links={it.links} />
        </li>
      ))}
    </Tag>
  )
}

function SectionBody({ section }: { section: ProseSection }) {
  return (
    <>
      {section.intro && <p className="prose-intro">{section.intro}</p>}
      {section.items.length > 0 && <ProseList items={section.items} ordered={section.ordered} />}
      {section.outro && <p className="prose-sub">{section.outro}</p>}
    </>
  )
}

export function ProseSectionView({ section, plain = false, testId }: { section: ProseSection; plain?: boolean; testId?: string }) {
  if (plain) {
    return (
      <section className="prose-plain" data-testid={testId}>
        <h3 className="sub-title">{section.title}</h3>
        <SectionBody section={section} />
      </section>
    )
  }
  return (
    <Panel title={section.title} data-testid={testId}>
      <SectionBody section={section} />
    </Panel>
  )
}

export function ProseTableView({
  table, testId, highlightRow,
}: { table: ProseTable; testId?: string; highlightRow?: (row: string[]) => boolean }) {
  return (
    <Panel title={table.title} data-testid={testId}>
      <div className="table-scroll sc">
        <table className="prose-table">
          <thead>
            <tr>{table.head.map(h => <th key={h} scope="col">{h}</th>)}</tr>
          </thead>
          <tbody>
            {table.rows.map((r, i) => (
              <tr key={i} className={highlightRow?.(r) ? 'hl' : undefined}>
                {r.map((c, j) => <td key={j}>{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.note && <p className="prose-sub">{table.note}</p>}
    </Panel>
  )
}

export function PromptBlock({ prompt }: { prompt: PromptTemplate }) {
  return (
    <figure className="prompt-block">
      <figcaption className="prompt-title">{prompt.title}</figcaption>
      <pre className="prompt">{prompt.body}</pre>
    </figure>
  )
}
