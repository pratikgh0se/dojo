import { defineConfig } from '@playwright/test'

// The public build ships no problem-list packs; e2e runs against the small original fixture packs (vite.config.ts bankPacksPath).
process.env.DOJO_BANK_PACKS ??= 'fixtures'
process.env.DOJO_PLAN ??= 'public'

// C-DESKTOP scenarios against the packaged Dojo.app (built once into a temp dir by the spec). Never ~/Dojo or
// ~/Applications: every launch gets its own temp DOJO_HOME.
export default defineConfig({
  testDir: 'tests/desktop',
  workers: 1,
  fullyParallel: false,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
})
