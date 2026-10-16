// R2 W7: what was deleted stays deleted, and what the deletion rule kept stays kept (spec 4.7).
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const has = (p: string): boolean => existsSync(resolve(process.cwd(), p))
const src = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8')

describe('the check gate is gone', () => {
  it('no move is refused with check_required and no code opens a check dialog', () => {
    for (const f of ['src/data/boardActions.ts', 'src/data/sessionActions.ts', 'src/data/ladderActions.ts', 'src/rules/board.ts', 'src/ui/useTick.ts', 'src/screens/Do.tsx']) {
      expect(src(f), f).not.toMatch(/check_required|needsCheck|openCheck/)
    }
  })
})

describe('the brief and check dialog stack is deleted; the read-only brief card is kept', () => {
  it.each([
    'src/screens/brief/BriefEditor.tsx', 'src/screens/brief/CheckDialog.tsx', 'src/screens/brief/CheckGate.tsx',
    'src/screens/brief/DeliverableDialog.tsx', 'src/data/briefActions.ts', 'src/lib/checkGate.ts',
  ])('%s is gone', p => expect(has(p)).toBe(false))
  it('keeps what a contract still uses', () => {
    expect(has('src/screens/brief/CardBrief.tsx')).toBe(true) // TICKET-25, tests/e2e/storage/briefs.spec.ts
    expect(has('src/ui/DraftIndicator.tsx')).toBe(true) // today-and-shell.md Required hooks row: draft-indicator
    expect(has('src/data/draftJob.ts')).toBe(true) // DraftIndicator and tests/setup.ts
    expect(src('src/screens/Do.tsx')).toContain('no-brief')
  })
  it('the brief card has no action buttons', () => {
    expect(src('src/screens/brief/CardBrief.tsx')).not.toMatch(/Edit brief|\bApprove\b|Check links|Mark done|CheckDialog|DeliverableDialog|BriefEditor/) // \bApprove\b: the "Approved" status chip stays
  })
})

describe('the forge stage titles and the brief rules are gone', () => {
  it.each(['src/rules/brief.ts', 'src/content/capstoneStages.ts'])('%s is gone', p => expect(has(p)).toBe(false))
  it('checkActions keeps the explain check and drops the deliverable path', () => {
    const s = src('src/data/checkActions.ts')
    expect(s).toContain('export async function submitExplainCheck')
    expect(s).toContain('export async function submitCheck')
    expect(s).not.toMatch(/submitDeliverable|deliverableFeedback|CAPSTONE_STAGES|rules\/brief/)
  })
})

describe('four unreachable files are gone; the two that are used stay', () => {
  it.each(['src/content/skillTiers.ts', 'src/rules/calendar.ts', 'src/rules/evidence.ts', 'src/ui/PlanAnchor.tsx'])('%s is gone', p => expect(has(p)).toBe(false))
  it('keeps Pom\'s form ladder and the private bank packs the default build aliases', () => {
    expect(has('src/rules/forms.ts')).toBe(true)
  })
})

describe('v12', () => {
  it('the app database is created holding v12 back, and no source file names the dropped tables or types', () => {
    expect(src('src/data/db.ts')).toContain('holdV12: true')
    for (const f of ['src/data/db.ts', 'src/data/types.ts']) expect(src(f), f).not.toMatch(/\bartifacts: Table|\bStageCell\b|\bBlankTest\b|interface Artifact\b/)
    expect(src('src/main.tsx')).toContain("import('./data/" + 'legacyDrop' + "')")
  })
})
