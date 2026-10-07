import { Fragment, useState } from 'react'

/**
 * UAT r3 J3: the stage statements name real files in the learner's own capstone repo ("grade it against
 * forge/stages/00-setup/rubric.md", "log questions in QUESTIONS.md"). They stay, shown as file references
 * (a monospace chip), not loose prose. Trailing punctuation stays outside the chip. UAT r4: the same chips in
 * AI-drafted brief text, and any bare `*.md` name (rubric.md, NOTES.md), never a piece of a URL or a longer path.
 */
export const FILE_REF = /\bforge\/[A-Za-z0-9_.\/-]*[A-Za-z0-9_\/]|(?<![\w/.:-])[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*\.md\b/g

/** A path in the learner's own repo: click or Enter copies it (cu-r2 A2#37: a chip that looks pressable must do something). */
function FileRef({ path }: { path: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void Promise.resolve(navigator.clipboard?.writeText(path)).catch(() => {})
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }
  return (
    <code
      className="file-ref" role="button" tabIndex={0} data-copied={copied ? 'true' : undefined}
      title={copied ? 'Copied' : 'A file in your own capstone repo. Click to copy its path.'}
      aria-label={`File in your capstone repo: ${path}. Press to copy the path.`}
      onClick={copy}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); copy() } }}
    >{path}</code>
  )
}

export function WithFileRefs({ text }: { text: string }) {
  const parts: Array<{ ref: boolean; s: string }> = []
  let last = 0
  for (const m of text.matchAll(FILE_REF)) {
    const at = m.index ?? 0
    if (at > last) parts.push({ ref: false, s: text.slice(last, at) })
    parts.push({ ref: true, s: m[0] })
    last = at + m[0].length
  }
  if (last < text.length) parts.push({ ref: false, s: text.slice(last) })
  return <>{parts.map((p, i) => (p.ref ? <FileRef key={i} path={p.s} /> : <Fragment key={i}>{p.s}</Fragment>))}</>
}
