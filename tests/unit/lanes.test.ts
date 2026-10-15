import { describe, expect, it } from 'vitest'
import { laneOf, mixLanes } from '../../src/rules/lanes'
import { mkTicket } from '../helpers/tickets'

describe('laneOf', () => {
  it('an explicit lane wins', () => {
    expect(laneOf(mkTicket({ id: 'a', lane: 'design', kind: 'problem' }))).toBe('design')
  })
  it('bank and mine tickets are the bank lane even when a lane was stored', () => {
    expect(laneOf(mkTicket({ id: 'a', origin: 'bank:neetcode150', kind: 'problem' }))).toBe('bank')
    expect(laneOf(mkTicket({ id: 'b', origin: 'mine', kind: 'problem' }))).toBe('bank')
  })
  it('pre-migration tickets fall back to kind and track', () => {
    expect(laneOf(mkTicket({ id: 'p', kind: 'problem', track: 'interview' }))).toBe('dsa')
    expect(laneOf(mkTicket({ id: 'd', kind: 'design', track: 'interview' }))).toBe('design')
    expect(laneOf(mkTicket({ id: 's', kind: 'stage', track: 'ai' }))).toBe('path')
    expect(laneOf(mkTicket({ id: 't', kind: 'task', track: 'interview', skill: 'sysd' }))).toBe('design')
    expect(laneOf(mkTicket({ id: 'u', kind: 'task', track: 'interview', skill: 'apply' }))).toBe('career')
    expect(laneOf(mkTicket({ id: 'v', kind: 'task', track: 'interview', skill: 'dsa' }))).toBe('dsa')
  })
})

describe('mixLanes', () => {
  it('career joins only when enabled', () => {
    expect(mixLanes(false)).toEqual(['path', 'dsa', 'design'])
    expect(mixLanes(true)).toEqual(['path', 'dsa', 'design', 'career'])
  })
})
