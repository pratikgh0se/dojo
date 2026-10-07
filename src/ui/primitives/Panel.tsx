import type { HTMLAttributes } from 'react'

export function Panel({ title, className = '', children, ...rest }: HTMLAttributes<HTMLElement> & { title?: string }) {
  return (
    <section className={`sr-panel ${className}`.trim()} {...rest}>
      {title && <h2 className="sr-panel-title">{title}</h2>}
      {children}
    </section>
  )
}
