import { useCallback, useEffect, useState } from 'react'

// C-RUNNER §4 Solved gate: the attempt cycle in which a Submit passed 5/5, per ticket. Kept beside the
// cycle itself (lib/cycle, localStorage), so a reload inside the same attempt keeps the gate open.
const key = (ticketId: string) => `dojo:run-pass:${ticketId}`

export function loadPassCycle(ticketId: string): string | null {
  try { return localStorage.getItem(key(ticketId)) } catch { return null }
}

export function savePassCycle(ticketId: string, cycleId: string): void {
  try { localStorage.setItem(key(ticketId), cycleId) } catch { /* storage off: the gate opens for this visit only */ }
}

/**
 * The gate's state on Do. M7: a passing Submit while the attempt's cycle does not exist yet (cycleId
 * '') is queued and applied to the cycle as soon as there is one, rather than dropped.
 */
export function usePassGate(ticketId: string, cycleId: string): { passCycle: string | null; onSubmitPassed: () => void } {
  const [passCycle, setPassCycle] = useState<string | null>(() => loadPassCycle(ticketId))
  const [queued, setQueued] = useState(false)
  useEffect(() => {
    if (!queued || !cycleId) return
    savePassCycle(ticketId, cycleId)
    setPassCycle(cycleId)
    setQueued(false)
  }, [queued, cycleId, ticketId])
  const onSubmitPassed = useCallback(() => {
    if (!cycleId) return setQueued(true)
    savePassCycle(ticketId, cycleId)
    setPassCycle(cycleId)
  }, [ticketId, cycleId])
  return { passCycle, onSubmitPassed }
}
