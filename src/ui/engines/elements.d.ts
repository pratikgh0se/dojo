import type { DetailedHTMLProps, HTMLAttributes } from 'react'

// React 18 passes props on custom elements through as attributes verbatim: `className` would
// become a literal `classname` attribute, so the wrappers set `class` instead.
type Base = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & { class?: string }

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'sr-chart': Base & { type: string; data: string; opts?: string }
      'pom-stage': Base & {
        who?: string; form?: string; pose?: string; autorotate?: string; zoom?: string; background?: string
      }
      'sr-algo': Base & {
        data?: string; src?: string; algo?: string; input?: string; theme?: string; speed?: string; autoplay?: string
      }
      'sr-algo2': Base & { data?: string; src?: string; theme?: string; speed?: string; autoplay?: string }
      'sr-diagram': Base & {
        type?: string; view?: string; data?: string; src?: string; opts?: string; play?: string; theme?: string
      }
    }
  }
}
