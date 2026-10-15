import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AppProviders } from '../../src/app/providers'
import { AppRoutes } from '../../src/app/routes'
import { freshDb } from '../helpers/db'
import { flatPlanV2 } from '../helpers/plan'
import { mkPlanV2 } from '../helpers/planV2'

// A screen whose chunk is slow to arrive: the route shows its fallback meanwhile (R17).
vi.mock('../../src/screens/Guide', async () => {
  await new Promise(r => setTimeout(r, 120))
  return { Guide: () => <p data-testid="guide-body">The guide.</p> }
})

const BANNED = /\binterview|\bSpar\b|\bRetreat\b|\bDig in\b|\bLoad check\b|\bSlid in\b|\bShift plan\b|overdue|missed day|\bbehind\b|streak (lost|broken)|you didn't|days (since|without)/i

describe('lazy route fallback (R17)', () => {
  it('shows a calm block inside the screen root while the chunk loads: no layout jump, no banned words, then the screen', async () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={['/guide']}>
        <AppProviders db={freshDb()} plan={flatPlanV2} planV2={mkPlanV2()}><AppRoutes /></AppProviders>
      </MemoryRouter>,
    )
    const root = screen.getByTestId('screen-guide')
    expect(root).toHaveAttribute('data-ready', 'false')
    const fb = root.querySelector('.sh-fallback')
    expect(fb).not.toBeNull()
    expect(fb!.querySelector('.loading')).not.toBeNull()
    expect(root.textContent).not.toMatch(BANNED)
    expect(root.querySelectorAll('button, a, input')).toHaveLength(0)
    expect(await screen.findByTestId('guide-body')).toBeInTheDocument()
    expect(root.querySelector('.sh-fallback')).toBeNull()
    await waitFor(() => expect(root).toHaveAttribute('data-ready', 'true'))
  })

  it('reserves the height of a short screen, and the shell stylesheet says so', async () => {
    const { readFileSync } = await import('node:fs')
    expect(readFileSync('src/app/shell/shell.css', 'utf8')).toMatch(/\.sh-fallback \{[^}]*min-height: 50dvh/)
  })
})
