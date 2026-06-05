import { describe, it, expect } from 'vitest'
import { processAmionEvents } from './process'

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
