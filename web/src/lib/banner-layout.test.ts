import { describe, it, expect } from 'vitest'
import { computeBannerSpans } from './banner-layout'
import type { CalendarEvent } from '../types'

function makeBannerEvent(id: string, startDate: string, endDate: string): CalendarEvent {
  return {
    id,
    title: id,
    start: `${startDate}T00:00:00Z`,
    end: `${endDate}T00:00:00Z`,
    all_day: true,
    is_amion: false,
    amion_kind: null,
    calendar_name: 'family',
    organizer_email: null,
    location: null,
    notes: null,
    overridden: false,
  } as unknown as CalendarEvent
}

const WEEK_DATES = ['2026-04-26','2026-04-27','2026-04-28','2026-04-29','2026-04-30','2026-05-01','2026-05-02']
//                  Sun         Mon         Tue         Wed         Thu         Fri         Sat

describe('computeBannerSpans', () => {
  it('returns empty for no banner events', () => {
    expect(computeBannerSpans([], WEEK_DATES)).toEqual([])
  })

  it('produces a single-day span for a one-day banner', () => {
    const events = [makeBannerEvent('e1', '2026-04-29', '2026-04-30')]  // Wed only (end is exclusive)
    const spans = computeBannerSpans(events, WEEK_DATES)
    expect(spans).toEqual([
      { id: 'e1', title: 'e1', startCol: 4, endCol: 5, lane: 0 },
    ])
  })

  it('spans the visible portion when event covers Wed–Fri', () => {
    const events = [makeBannerEvent('e1', '2026-04-29', '2026-05-02')]  // Wed, Thu, Fri (end exclusive)
    const spans = computeBannerSpans(events, WEEK_DATES)
    expect(spans).toEqual([
      { id: 'e1', title: 'e1', startCol: 4, endCol: 7, lane: 0 },
    ])
  })

  it('clips an event that starts before the visible week', () => {
    const events = [makeBannerEvent('e1', '2026-04-23', '2026-04-28')]  // ...Sun, Mon (visible part)
    const spans = computeBannerSpans(events, WEEK_DATES)
    expect(spans).toEqual([
      { id: 'e1', title: 'e1', startCol: 1, endCol: 3, lane: 0 },
    ])
  })

  it('clips an event that ends after the visible week', () => {
    const events = [makeBannerEvent('e1', '2026-05-01', '2026-05-05')]  // Fri, Sat (visible part)
    const spans = computeBannerSpans(events, WEEK_DATES)
    expect(spans).toEqual([
      { id: 'e1', title: 'e1', startCol: 6, endCol: 8, lane: 0 },
    ])
  })

  it('drops events that fall entirely outside the week', () => {
    const events = [makeBannerEvent('e1', '2026-05-10', '2026-05-12')]
    expect(computeBannerSpans(events, WEEK_DATES)).toEqual([])
  })

  it('lays overlapping events into separate lanes', () => {
    const events = [
      makeBannerEvent('e1', '2026-04-27', '2026-04-30'),  // Mon-Wed (lane 0)
      makeBannerEvent('e2', '2026-04-29', '2026-05-02'),  // Wed-Fri (overlaps e1 on Wed → lane 1)
    ]
    const spans = computeBannerSpans(events, WEEK_DATES)
    expect(spans).toEqual([
      { id: 'e1', title: 'e1', startCol: 2, endCol: 5, lane: 0 },
      { id: 'e2', title: 'e2', startCol: 4, endCol: 7, lane: 1 },
    ])
  })

  it('reuses lane 0 when events do not overlap', () => {
    const events = [
      makeBannerEvent('e1', '2026-04-26', '2026-04-28'),  // Sun-Mon (lane 0)
      makeBannerEvent('e2', '2026-04-30', '2026-05-02'),  // Thu-Fri (no overlap → lane 0)
    ]
    const spans = computeBannerSpans(events, WEEK_DATES)
    expect(spans).toEqual([
      { id: 'e1', title: 'e1', startCol: 1, endCol: 3, lane: 0 },
      { id: 'e2', title: 'e2', startCol: 5, endCol: 7, lane: 0 },
    ])
  })
})
