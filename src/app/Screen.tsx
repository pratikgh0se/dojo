import { useEffect, useRef, useState, type ReactNode } from 'react'

export type ScreenName =
  | 'today' | 'board' | 'do' | 'dsa' | 'designs' | 'ai' | 'banks' | 'progress' | 'settings'
  | 'atlas' | 'map' | 'week' | 'overview' | 'mentors' | 'ritual' | 'design-session'

/**
 * Contract UX addendum 1, Q1: every routed screen's root carries `screen-<name>`, and `data-ready="true"`
 * once its content has rendered (no "Loading…" placeholder, including a lazy chunk's Suspense fallback).
 * It replaces the grid the page shell used to give a screen's own root, so layout is unchanged.
 */
export function Screen(props: { name: ScreenName; children: ReactNode }) {
  // UAT r3 J2: <Routes> reuses this element across routes, so a new screen inherited the last one's
  // data-ready="true" while it still showed its loading line. A new screen gets a new root.
  return <ScreenRoot key={props.name} {...props} />
}

function ScreenRoot({ name, children }: { name: ScreenName; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const done = () => !!el.firstChild && !el.querySelector('.loading')
    if (done()) return setReady(true)
    // once ready it stays ready: stop watching the (possibly large) subtree the moment it is
    const mo = new MutationObserver(() => {
      if (done()) {
        setReady(true)
        mo.disconnect()
      }
    })
    mo.observe(el, { childList: true, subtree: true })
    return () => mo.disconnect()
  }, [])
  return (
    <div ref={ref} className="screen-root" data-testid={`screen-${name}`} data-ready={String(ready)}>{children}</div>
  )
}
