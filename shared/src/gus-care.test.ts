import { describe, it, expect } from 'vitest'
import { computeGusCare } from './gus-care'
import type { CalendarEvent, GusOverride } from './types'

// 2026-07-06 is a Monday. With no events, Caitie is on point for both roles.
const WEEK = ['2026-07-06', '2026-07-07', '2026-07-08']

function gusCareFor(date: string, overrides?: GusOverride[]) {
  const events: CalendarEvent[] = []
  return computeGusCare(events, WEEK, overrides).find(g => g.date === date)!
}

describe('computeGusCare — manual overrides', () => {
  it('defaults to the computed owner when there is no override', () => {
    const g = gusCareFor('2026-07-06')
    expect(g.pickup).toBe('caitie')
    expect(g.dropoff).toBe('caitie')
    expect(g.pickupOverridden).toBeFalsy()
    expect(g.dropoffOverridden).toBeFalsy()
  })

  it('lets a manual override win over the algorithm and flags it', () => {
    const overrides: GusOverride[] = [
      { id: '1', date: '2026-07-06', role: 'pickup', owner: 'nat', created_by: 'x' },
    ]
    const g = gusCareFor('2026-07-06', overrides)
    expect(g.pickup).toBe('nat')
    expect(g.pickupOverridden).toBe(true)
    // dropoff is untouched by a pickup override
    expect(g.dropoff).toBe('caitie')
    expect(g.dropoffOverridden).toBeFalsy()
  })

  it('applies pickup and dropoff overrides independently', () => {
    const overrides: GusOverride[] = [
      { id: '1', date: '2026-07-07', role: 'dropoff', owner: 'nat', created_by: 'x' },
    ]
    const g = gusCareFor('2026-07-07', overrides)
    expect(g.dropoff).toBe('nat')
    expect(g.dropoffOverridden).toBe(true)
    expect(g.pickup).toBe('caitie')
  })

  it('only applies an override to its own date', () => {
    const overrides: GusOverride[] = [
      { id: '1', date: '2026-07-06', role: 'pickup', owner: 'nat', created_by: 'x' },
    ]
    const other = gusCareFor('2026-07-08', overrides)
    expect(other.pickup).toBe('caitie')
    expect(other.pickupOverridden).toBeFalsy()
  })
})
