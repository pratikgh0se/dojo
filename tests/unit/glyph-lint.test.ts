import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// BRAND.md: UI icons are 7 x 7 pixel glyphs, not Unicode marks that draw per operating system.
const BANNED = /[✓✗✕★▸▾‹›↗]/
const FILES = [
  'src/ui/TicketRow.tsx', 'src/runner/CodePanel.tsx', 'src/ui/algo/ApproachStrip.tsx', 'src/ui/Prose.tsx', 'src/screens/Onboarding.tsx',
  'src/screens/Do.tsx', 'src/screens/do/study/SessionHistory.tsx',
  'src/screens/Path.tsx', 'src/screens/Review.tsx', 'src/screens/Skills.tsx', 'src/screens/Guide.tsx', 'src/screens/Today.tsx', 'src/screens/Settings.tsx',
  'src/screens/today/QuestCard.tsx', 'src/screens/today/PickElse.tsx', 'src/screens/today/StatsDrawer.tsx', 'src/content/guide.ts',
]
const DIRS = ['src/app/shell', 'src/screens/path', 'src/screens/review', 'src/screens/skills', 'src/screens/do/kinds']

const walk = (d: string): string[] => readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p] })
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('no Unicode marks in the screens this release owns', () => {
  const files = [...FILES, ...DIRS.filter(existsSync).flatMap(walk)].filter(f => existsSync(f) && /\.(ts|tsx)$/.test(f))
  it('finds files to scan', () => expect(files.length).toBeGreaterThan(5))
  it('uses Glyph instead', () => {
    const bad = files.filter(f => BANNED.test(stripComments(readFileSync(f, 'utf8'))))
    expect(bad).toEqual([])
  })
})
