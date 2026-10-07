import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { AppProviders } from '../../src/app/providers'
import type { DojoDB } from '../../src/data/db'
import type { PlanJson } from '../../src/data/types'

function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="location" data-search={loc.search}>{loc.pathname}</div>
}

export function renderWithApp(
  ui: ReactElement,
  opts: { db: DojoDB; plan: PlanJson; route?: string; path?: string },
) {
  const { db, plan, route = '/', path = '*' } = opts
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={[route]}>
      <AppProviders db={db} plan={plan}>
        <Routes>
          <Route path={path} element={ui} />
        </Routes>
        <LocationProbe />
      </AppProviders>
    </MemoryRouter>,
  )
}
