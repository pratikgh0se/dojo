import { defineConfig, devices } from '@playwright/test'
import { dojoBaseUrl } from './dojoPort'
import { REAL_URL } from './tests/e2e/storage/harness'
import { REAL_FILES, REAL_GREP } from './tests/e2e/real/subset'

// The public build ships no problem-list packs; e2e runs against the small original fixture packs (vite.config.ts bankPacksPath).
process.env.DOJO_BANK_PACKS ??= 'fixtures'
process.env.DOJO_PLAN ??= 'public'

const BASE_URL = dojoBaseUrl(process.env)

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: BASE_URL,
    timezoneId: 'Asia/Kolkata',
    trace: 'retain-on-failure',
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  // The storage project builds the app once and runs its own dojo-server (per-test temp DOJO_HOME,
  // started and stopped by the specs). Everything else runs against vite dev on Dexie alone: the
  // suite shares no server-side state, so its tests stay independent of each other.
  globalSetup: './tests/e2e/storage/global-setup.ts',
  // `real` (I9) re-runs a representative subset of the specs against dojo-server serving that build
  // with disk sync on, one fresh DOJO_HOME per test file (tests/e2e/fixtures.ts, real/subset.ts).
  projects: [
    { name: 'chromium', testIgnore: '**/storage/**', use: { ...devices['Desktop Chrome'] } },
    { name: 'storage', testMatch: '**/storage/**/*.spec.ts', use: { ...devices['Desktop Chrome'] } },
    { name: 'real', testMatch: REAL_FILES, grep: REAL_GREP, use: { ...devices['Desktop Chrome'], baseURL: REAL_URL } },
  ],
  webServer: {
    // `npm run dev` inherits DOJO_PORT (Playwright passes process.env by default).
    command: 'npm run dev',
    env: { DOJO_DEV_DISK: 'off' },
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
