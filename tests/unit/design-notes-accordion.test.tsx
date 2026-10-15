import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { DesignNotes } from '../../src/rules/designDigest'
import { addTable, emptyNotes, setNoteText } from '../../src/rules/designNotes'
import { NotesPanel } from '../../src/screens/designSession/NotesPanel'
import { notesOpenKey, readOpen, useNotesOpen } from '../../src/screens/designSession/notesOpen'

const IDS = ['requirements', 'assumptions', 'api', 'data-model', 'tradeoffs', 'open']
const tid = (id: string) => screen.getByTestId(id)

function Harness({ sessionId = 's1', initial = emptyNotes(), allOpen = false, locked = false }: { sessionId?: string; initial?: DesignNotes; allOpen?: boolean; locked?: boolean }) {
  const [n, setN] = useState(initial)
  const accordion = useNotesOpen(sessionId)
  return <NotesPanel notes={n} locked={locked} allOpen={allOpen} accordion={accordion} linkedIds={new Set()} onChange={setN} onEscape={() => {}} />
}

beforeEach(() => sessionStorage.clear())

describe('notes accordion (F2)', () => {
  it('first view: only Requirements is open; every section has a toggle with aria-expanded, a title and a count', () => {
    render(<Harness />)
    for (const id of IDS) {
      const toggle = tid(`notes-section-${id}-toggle`)
      expect(toggle.tagName).toBe('BUTTON')
      expect(toggle).toHaveAttribute('aria-expanded', id === 'requirements' ? 'true' : 'false')
      expect(toggle).toContainElement(tid(`notes-section-${id}-title`))
      expect(toggle).toContainElement(tid(`notes-section-${id}-count`))
      expect(tid(`notes-section-${id}-count`)).toHaveTextContent('0')
    }
    expect(tid('notes-section-assumptions-title')).toHaveTextContent(/^Assumptions and estimates$/)
  })
  it('a closed section keeps its field mounted but hidden; opening shows it; several can be open', () => {
    render(<Harness />)
    expect(tid('notes-field-api')).not.toBeVisible()
    expect(tid('notes-field-api')).toBeInTheDocument()
    fireEvent.click(tid('notes-section-api-toggle'))
    fireEvent.click(tid('notes-section-open-toggle'))
    expect(tid('notes-field-api')).toBeVisible()
    expect(tid('notes-field-open')).toBeVisible()
    expect(tid('notes-field-req-fn')).toBeVisible()
    expect(tid('notes-section-api-toggle')).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(tid('notes-section-api-toggle'))
    expect(tid('notes-field-api')).not.toBeVisible()
  })
  it('typing in a closed (hidden) box still changes the notes; the count follows the lines', () => {
    render(<Harness />)
    fireEvent.change(tid('notes-field-api'), { target: { value: 'GET /a\n\nPOST /b' } })
    expect(tid('notes-section-api-count')).toHaveTextContent('2')
  })
  it('Data model counts its tables', () => {
    render(<Harness initial={addTable(setNoteText(emptyNotes(), 'dataModel', 'x'), 'layers').notes} />)
    expect(tid('notes-section-data-model-count')).toHaveTextContent('1 table')
  })
  it('the open set is kept per session in sessionStorage and survives a remount', () => {
    const first = render(<Harness sessionId="s1" />)
    fireEvent.click(tid('notes-section-tradeoffs-toggle'))
    expect(JSON.parse(sessionStorage.getItem(notesOpenKey('s1'))!).sort()).toEqual(['requirements', 'tradeoffs'])
    first.unmount()
    render(<Harness sessionId="s1" />)
    expect(tid('notes-section-tradeoffs-toggle')).toHaveAttribute('aria-expanded', 'true')
    expect(tid('notes-section-api-toggle')).toHaveAttribute('aria-expanded', 'false')
  })
  it('another session starts with only Requirements open', () => {
    sessionStorage.setItem(notesOpenKey('s1'), JSON.stringify(['api']))
    render(<Harness sessionId="s2" />)
    expect(tid('notes-section-requirements-toggle')).toHaveAttribute('aria-expanded', 'true')
    expect(tid('notes-section-api-toggle')).toHaveAttribute('aria-expanded', 'false')
  })
  it('does not write on load; a damaged value reads as the default', () => {
    render(<Harness />)
    expect(sessionStorage.getItem(notesOpenKey('s1'))).toBeNull()
    sessionStorage.setItem(notesOpenKey('s1'), '{nope')
    expect(readOpen('s1')).toEqual(['requirements'])
    sessionStorage.setItem(notesOpenKey('s1'), JSON.stringify(['api', 'bogus', 7]))
    expect(readOpen('s1')).toEqual(['api'])
  })
  it('in the close and score phases every section is open and the boxes are read-only', () => {
    render(<Harness allOpen locked />)
    for (const id of IDS) expect(tid(`notes-section-${id}-toggle`)).toHaveAttribute('aria-expanded', 'true')
    expect(tid('notes-field-open')).toBeVisible()
    expect(tid('notes-field-open')).toHaveAttribute('readonly')
    fireEvent.click(tid('notes-section-api-toggle'))
    expect(tid('notes-field-api')).toBeVisible()
  })
  it('ensure() opens a section (Ctrl/Cmd+. opens Requirements) and persists', () => {
    const { result } = renderHook(() => useNotesOpen('s9'))
    act(() => result.current.toggle('requirements'))
    expect(result.current.open.has('requirements')).toBe(false)
    act(() => result.current.ensure('requirements'))
    expect(result.current.open.has('requirements')).toBe(true)
    act(() => result.current.ensure('requirements'))
    expect(result.current.open.has('requirements')).toBe(true)
    expect(readOpen('s9')).toEqual(['requirements'])
  })
})
