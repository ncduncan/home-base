import { describe, it, expect } from 'vitest'
import { processAmionEvents, parseCalendarSources } from './process'

// A raw timed Google Calendar item for a Gus event on one calendar source.
function gusItem(
  id: string,
  summary: 'Gus pickup' | 'Gus dropoff',
  date: string,
  opts: { owner?: 'nat' | 'caitie'; iCalUID?: string } = {},
): Record<string, unknown> {
  return {
    id,
    iCalUID: opts.iCalUID ?? `${id}@google.com`,
    summary,
    status: 'confirmed',
    start: { dateTime: `${date}T07:00:00-04:00` },
    end: { dateTime: `${date}T08:00:00-04:00` },
    ...(opts.owner
      ? { extendedProperties: { private: { homebase_owner: opts.owner, homebase_gus_key: `${date}-dropoff` } } }
      : {}),
  }
}

describe('parseCalendarSources — Gus duplicate collapse (stale mirror calendar)', () => {
  it('collapses a canonical Gus event and a stale mirror copy with a different id/uid', () => {
    // Primary calendar: the canonical event (recreated after an owner flip → new id).
    const primary = {
      cal: { id: 'ncduncan@gmail.com', summary: 'Nat Personal' },
      items: [gusItem('newid123', 'Gus dropoff', '2026-07-08', { owner: 'caitie', iCalUID: 'newid123@google.com' })],
    }
    // Mirror iCal import: the pre-flip copy — different id, different uid, NO homebase_owner.
    const mirror = {
      cal: { id: 'mirror@import.calendar.google.com', summary: 'Calendar' },
      items: [gusItem('oldid456', 'Gus dropoff', '2026-07-08', { iCalUID: 'oldid456@google.com' })],
    }
    const events = parseCalendarSources([primary, mirror])
    const dropoffs = events.filter(e => e.title === 'Gus dropoff' && e.start.startsWith('2026-07-08'))
    expect(dropoffs).toHaveLength(1)
    expect(dropoffs[0].id).toBe('newid123')          // kept the canonical copy
    expect(dropoffs[0].homebase_owner).toBe('caitie')
  })

  it('keeps distinct Gus events on different dates', () => {
    const primary = {
      cal: { id: 'ncduncan@gmail.com', summary: 'Nat Personal' },
      items: [
        gusItem('a', 'Gus dropoff', '2026-07-08', { owner: 'caitie' }),
        gusItem('b', 'Gus dropoff', '2026-07-09', { owner: 'nat' }),
      ],
    }
    const events = parseCalendarSources([primary])
    expect(events.filter(e => e.title === 'Gus dropoff')).toHaveLength(2)
  })
})

// Build a raw AMION all-day item for a single day (Google uses exclusive end.date).
function allDay(summary: string, date: string): Record<string, unknown> {
  const d = new Date(`${date}T12:00:00`)
  d.setDate(d.getDate() + 1)
  const end = d.toISOString().slice(0, 10)
  return {
    summary,
    status: 'confirmed',
    start: { date },
    end: { date: end },
  }
}

const kinds = (date: string, items: Record<string, unknown>[]) =>
  processAmionEvents(items)
    .filter(e => e.start.startsWith(date))
    .map(e => e.amion_kind)

describe('processAmionEvents — Call: Chief (passive phone-call role)', () => {
  // 2026-06-01 is a Monday, 2026-06-06 is a Saturday.
  it('SC week weekday: SC1 + Call: Chief + Call: SC1 → Backup, never Day Shift', () => {
    const date = '2026-06-01'
    const items = [
      allDay('SC1', date),
      allDay('Call: Chief', date),
      allDay('Call: SC1', date),
    ]
    expect(kinds(date, items)).toEqual(['backup'])
  })

  it('SC week weekend: same events → Backup, never 24hr/Day Shift', () => {
    const date = '2026-06-06'
    const items = [
      allDay('SC1', date),
      allDay('Call: Chief', date),
      allDay('Call: SC1', date),
    ]
    expect(kinds(date, items)).toEqual(['backup'])
  })

  it('rotation weekday: 11H-Medical + Call: Chief → Day Shift (rotation wins, no backup chip)', () => {
    const date = '2026-06-16' // Tuesday
    const items = [
      allDay('11H-Medical', date),
      allDay('Call: Chief', date),
    ]
    expect(kinds(date, items)).toEqual(['day'])
  })
})
