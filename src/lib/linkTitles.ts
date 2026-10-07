/**
 * UAT cu-r3b P3-3: an external link names its destination on hover and on focus. Every `target="_blank"` link without a title
 * of its own gets the address as its title the moment the pointer or focus reaches it (one delegated listener, so no link
 * has to remember). Returns the remover.
 */
export function titleExternalLinks(root: Document = document): () => void {
  const apply = (e: Event) => {
    const t = e.target
    if (!(t instanceof Element)) return
    const a = t.closest('a[target="_blank"][href]')
    if (a instanceof HTMLAnchorElement && !a.hasAttribute('title') && /^https?:/i.test(a.href)) a.title = a.href
  }
  root.addEventListener('mouseover', apply, true)
  root.addEventListener('focusin', apply, true)
  return () => { root.removeEventListener('mouseover', apply, true); root.removeEventListener('focusin', apply, true) }
}
