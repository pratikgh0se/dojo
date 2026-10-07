import type { HTMLAttributes } from 'react'

export function Tile({ className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`sr-tile ${className}`.trim()} {...rest} />
}
