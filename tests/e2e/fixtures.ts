// The `test` for specs that also run in the `real` project (I9). In every other project it is plain
// @playwright/test. In `real`, each test FILE gets its own dojo-server with a fresh DOJO_HOME, started
// before the file's first test (a per-file beforeAll, shared through a worker fixture because the
// specs themselves stay unchanged) and disposed when the next file starts or the worker ends.
import { test as base } from '@playwright/test'
import { REAL_PORT, ServerHarness } from './storage/harness'

export { expect } from '@playwright/test'
export type { Locator, Page } from '@playwright/test'

class PerFileServer {
  private file: string | null = null
  private srv: ServerHarness | null = null
  get server() { return this.srv }
  async forFile(file: string) {
    if (this.file === file) return
    await this.dispose()
    this.srv = new ServerHarness(REAL_PORT)
    await this.srv.start()
    this.file = file
  }
  async dispose() {
    await this.srv?.dispose()
    this.srv = null
    this.file = null
  }
}

export const test = base.extend<{ realServer: void }, { perFileServer: PerFileServer }>({
  // Addendum 3: in `real`, every page is the writer (the launcher's /#writer=<token>).
  context: async ({ context, perFileServer }, use, testInfo) => {
    if (testInfo.project.name === 'real') {
      await perFileServer.forFile(testInfo.file)
      await perFileServer.server!.makeWriter(context)
    }
    await use(context)
  },
  perFileServer: [async ({}, use) => {
    const s = new PerFileServer()
    await use(s)
    await s.dispose()
  }, { scope: 'worker' }],
  realServer: [async ({ perFileServer }, use, testInfo) => {
    if (testInfo.project.name === 'real') await perFileServer.forFile(testInfo.file)
    await use()
  }, { auto: true }],
})
