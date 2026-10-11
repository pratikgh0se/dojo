import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { appRoute } from '../lib/appLinks'

/** A plan link: "#bank"-style links open that screen in the app; anything else opens in the browser. */
export function PlanAnchor({ href, children, ...rest }: { href: string; children: ReactNode } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'target' | 'rel'>) {
  const route = appRoute(href)
  if (route) return <Link to={route} {...rest}>{children}</Link>
  return <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>{children}</a>
}
