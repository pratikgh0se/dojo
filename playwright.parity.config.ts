import { existsSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'
import { dojoBaseUrl, parityBaseUrl, parityPort } from './dojoPort'

// The public build ships no problem-list packs; e2e runs against the small original fixture packs (vite.config.ts bankPacksPath).
process.env.DOJO_BANK_PACKS ??= 'fixtures'
process.env.DOJO_PLAN ??= 'public'

const BASE_URL = dojoBaseUrl(process.env)
const PROTO_URL = parityBaseUrl(process.env)
// The prototypes are the maintainer's; without them (the public repo) the specs skip and no prototype server is started.
const HAVE_PROTOTYPES = existsSync(new URL('./design_handoff_quest_dashboard/README.md', import.meta.url))

export default defineConfig({
  testDir: './tests/parity',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  use: {
    baseURL: BASE_URL,
    timezoneId: 'Asia/Kolkata',
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  // C3: refuse a (reused) server whose database is the real ~/Dojo.
  globalSetup: './tests/e2e/guard-setup.ts',
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    { command: 'npm run dev', env: { DOJO_DEV_DISK: 'off' }, url: BASE_URL, reuseExistingServer: true, timeout: 60_000 },
    ...(HAVE_PROTOTYPES ? [{
      command: `python3 -m http.server ${parityPort(process.env)} --bind 127.0.0.1 --directory design_handoff_quest_dashboard`,
      url: `${PROTO_URL}/README.md`,
      reuseExistingServer: true,
      timeout: 30_000,
    }] : []),
  ],
})
