import { createContext, useContext } from 'react'
import type { RailState } from './useRailLabels'

/** What a screen may ask of the shell: the shortcuts overlay (the Guide's "Show all shortcuts", NAV-31). */
export interface ShellActions { openShortcuts: () => void }
export const ShellActionsContext = createContext<ShellActions>({ openShortcuts: () => {} })
export const useShellActions = (): ShellActions => useContext(ShellActionsContext)

/** The rail's state, for Settings: its switch and `shell-rail-toggle` always agree (SHELL-11). Null outside the shell. */
export const RailStateContext = createContext<RailState | null>(null)
export const useRailState = (): RailState | null => useContext(RailStateContext)
