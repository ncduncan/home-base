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

describe('computeGusCare — AMION Research days', () => {
  const DATE = '2026-07-06' // Monday

  const amion = (kind: CalendarEvent['amion_kind'], start: string, end: string): CalendarEvent => ({
    id: `amion-${kind}`,
    title: '',
    start,
    end,
    location: null,
    all_day: kind === 'research' || kind === 'backup',
    calendar_name: 'Caitie shifts',
    is_amion: true,
    amion_kind: kind,
  })

  const research = amion('research', `${DATE}T00:00:00`, `${DATE}T00:00:00`)

  it('leaves Caitie on point for BOTH pickup and dropoff', () => {
    const g = computeGusCare([research], WEEK).find(d => d.date === DATE)!
    expect(g.pickup).toBe('caitie')
    expect(g.dropoff).toBe('caitie')
  })

  it('a real day shift still hands both slots to Nat (research is not masking it)', () => {
    const day = amion('day', `${DATE}T08:00:00`, `${DATE}T18:00:00`)
    const g = computeGusCare([day], WEEK).find(d => d.date === DATE)!
    expect(g.pickup).toBe('nat')
    expect(g.dropoff).toBe('nat')
  })

  it('a real non-AMION conflict on a research day still blocks pickup', () => {
    // A 4–6pm lab meeting on her "Caitie research" Google calendar covers 5pm.
    const labMeeting: CalendarEvent = {
      id: 'lab',
      title: 'Lab meeting',
      start: `${DATE}T16:00:00`,
      end: `${DATE}T18:00:00`,
      location: null,
      all_day: false,
      calendar_name: 'Caitie research',
      is_amion: false,
    }
    const g = computeGusCare([research, labMeeting], WEEK).find(d => d.date === DATE)!
    expect(g.pickup).toBe('nat')
    expect(g.dropoff).toBe('caitie') // a 4pm start doesn't block a 7:30am dropoff
  })

  it('labels the day as Research in the reason string', () => {
    const g = computeGusCare([research], WEEK).find(d => d.date === DATE)!
    expect(g.reason).toBe('Caitie: Research')
  })
})
