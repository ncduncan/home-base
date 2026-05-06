import { describe, it, expect } from 'vitest'
import { computeRangeBlock, computeNatWorkBlock } from './busy-block'
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

// 2026-05-04 is a Monday. 2026-05-09 is a Saturday.
const monday = '2026-05-04'
const saturday = '2026-05-09'

describe('computeNatWorkBlock', () => {
  it('M–F → 8am–5pm with "Work" label', () => {
    expect(computeNatWorkBlock(monday)).toEqual({
      startISO: `${monday}T08:00:00`,
      endISO: `${monday}T17:00:00`,
      crossesMidnight: false,
      label: 'Work',
    })
  })

  it('weekend → null', () => {
    expect(computeNatWorkBlock(saturday)).toBeNull()
  })
})

describe('computeRangeBlock', () => {
  it('empty → null', () => {
    expect(computeRangeBlock([])).toBeNull()
  })

  it('single event → that range, unlabeled', () => {
    const block = computeRangeBlock([evt(`${monday}T09:00:00`, `${monday}T10:00:00`)])
    expect(block).toEqual({
      startISO: `${monday}T09:00:00`,
      endISO: `${monday}T10:00:00`,
      crossesMidnight: false,
    })
  })

  it('multi-event range collapses to earliest start / latest end', () => {
    const block = computeRangeBlock([
      evt(`${monday}T11:00:00`, `${monday}T12:00:00`),
      evt(`${monday}T09:00:00`, `${monday}T10:00:00`),
      evt(`${monday}T15:00:00`, `${monday}T17:30:00`),
    ])
    expect(block?.startISO).toBe(`${monday}T09:00:00`)
    expect(block?.endISO).toBe(`${monday}T17:30:00`)
    expect(block?.crossesMidnight).toBe(false)
  })

  it('event crossing midnight → crossesMidnight true', () => {
    const block = computeRangeBlock([evt(`${monday}T16:00:00`, `2026-05-05T08:00:00`)])
    expect(block?.crossesMidnight).toBe(true)
    expect(block?.startISO).toBe(`${monday}T16:00:00`)
    expect(block?.endISO).toBe(`2026-05-05T08:00:00`)
  })
})
