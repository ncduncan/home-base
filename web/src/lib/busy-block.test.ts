import { describe, it, expect } from 'vitest'
import { computeBusyBlock } from './busy-block'
import type { CalendarEvent } from '@home-base/shared/types'

function evt(start: string, end: string, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: extra.id ?? `evt-${start}`,
    title: extra.title ?? 'Event',
    start,
    end,
    location: null,
    all_day: false,
    calendar_name: 'primary',
    is_amion: false,
    ...extra,
  }
}

describe('computeBusyBlock', () => {
  // 2026-05-04 is a Monday. 2026-05-09 is a Saturday.
  const monday = '2026-05-04'
  const saturday = '2026-05-09'

  it('Nat M–F with no events → 8am–5pm synthetic baseline', () => {
    const block = computeBusyBlock([], 'nat', monday)
    expect(block).toEqual({
      startISO: `${monday}T08:00:00`,
      endISO: `${monday}T17:00:00`,
      crossesMidnight: false,
    })
  })

  it('Nat Mon with 7am event → 7am–5pm', () => {
    const block = computeBusyBlock(
      [evt(`${monday}T07:00:00`, `${monday}T08:00:00`)],
      'nat',
      monday,
    )
    expect(block?.startISO).toBe(`${monday}T07:00:00`)
    expect(block?.endISO).toBe(`${monday}T17:00:00`)
  })

  it('Nat Mon with 6pm event → 8am–6pm', () => {
    const block = computeBusyBlock(
      [evt(`${monday}T18:00:00`, `${monday}T19:30:00`)],
      'nat',
      monday,
    )
    expect(block?.startISO).toBe(`${monday}T08:00:00`)
    expect(block?.endISO).toBe(`${monday}T19:30:00`)
  })

  it('Nat Sat with no events → null (no synthetic baseline on weekends)', () => {
    expect(computeBusyBlock([], 'nat', saturday)).toBeNull()
  })

  it('Caitie weekday with one event 9am–10am → 9am–10am', () => {
    const block = computeBusyBlock(
      [evt(`${monday}T09:00:00`, `${monday}T10:00:00`)],
      'caitie',
      monday,
    )
    expect(block).toEqual({
      startISO: `${monday}T09:00:00`,
      endISO: `${monday}T10:00:00`,
      crossesMidnight: false,
    })
  })

  it('Caitie weekend with no events → null', () => {
    expect(computeBusyBlock([], 'caitie', saturday)).toBeNull()
  })

  it('Multi-event range collapses to earliest start / latest end', () => {
    const block = computeBusyBlock(
      [
        evt(`${monday}T11:00:00`, `${monday}T12:00:00`),
        evt(`${monday}T09:00:00`, `${monday}T10:00:00`),
        evt(`${monday}T15:00:00`, `${monday}T17:30:00`),
      ],
      'caitie',
      monday,
    )
    expect(block?.startISO).toBe(`${monday}T09:00:00`)
    expect(block?.endISO).toBe(`${monday}T17:30:00`)
  })

  it('Crossing midnight (4pm → next-day 8am) → crossesMidnight true', () => {
    const block = computeBusyBlock(
      [evt(`${monday}T16:00:00`, `2026-05-05T08:00:00`)],
      'caitie',
      monday,
    )
    expect(block?.crossesMidnight).toBe(true)
    expect(block?.startISO).toBe(`${monday}T16:00:00`)
    expect(block?.endISO).toBe(`2026-05-05T08:00:00`)
  })
})
