import { forwardRef, type ButtonHTMLAttributes } from 'react'

export type ButtonVariant = 'control' | 'accent' | 'quiet' | 'danger'

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }>(
  function Button({ variant = 'control', className = '', ...rest }, ref) {
    return <button ref={ref} type="button" className={`sr-btn sr-btn-${variant} ${className}`.trim()} {...rest} />
  },
)
