import { useEffect, useState } from 'react'
import { now } from './clock'

export function useNow(intervalMs = 1000): number {
  const [t, setT] = useState(() => now())
  useEffect(() => {
    const iv = window.setInterval(() => setT(now()), intervalMs)
    return () => window.clearInterval(iv)
  }, [intervalMs])
  return t
}
