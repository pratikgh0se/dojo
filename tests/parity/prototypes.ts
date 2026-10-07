import { existsSync } from 'node:fs'

/** The design prototypes the parity specs screenshot against. They live in the maintainer's private repo, not in the public one. */
export const PROTOTYPES_PRESENT = existsSync(new URL('../../design_handoff_quest_dashboard/README.md', import.meta.url))
export const NO_PROTOTYPES = 'design prototypes (design_handoff_quest_dashboard/) are not in this repository; parity is maintainer-only'
if (!PROTOTYPES_PRESENT) console.log(`parity skipped: ${NO_PROTOTYPES}`)
