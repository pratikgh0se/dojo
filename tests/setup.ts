import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { resetNow } from '../src/lib/clock'
import { resetDraftJob } from '../src/data/draftJob'
import { resetOrigin } from '../src/app/origin'

// Unit tests run as the writer (Addendum 3); read-only behaviour is tested explicitly.
const giveWriterToken = () => { if (typeof localStorage !== 'undefined') localStorage.setItem('dojo.writer', 'test-writer') }
giveWriterToken()

// jsdom has no layout: its window.scrollTo only logs "Not implemented" (the Shell resets scroll on each new screen)
if (typeof window !== 'undefined') window.scrollTo = (() => {}) as typeof window.scrollTo

afterEach(() => {
  cleanup()
  // ports.test.ts runs `@vitest-environment node` (importing vite.config.ts trips an esbuild/jsdom
  // startup check), so this shared setup file cannot assume localStorage exists.
  if (typeof localStorage !== 'undefined') localStorage.clear()
  giveWriterToken()
  resetNow()
  resetDraftJob()
  resetOrigin()
})
