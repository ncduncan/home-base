import { parseISO, isBefore, isAfter } from 'date-fns'
import type { CalendarEvent } from '../types'

export interface BannerSpan {
  id: string
  title: string
  startCol: number   // 1-based grid column (inclusive)
  endCol: number     // 1-based grid column (exclusive — i.e. grid-column-end)
  lane: number       // 0 = first banner row, 1 = second, etc.
}

/**
 * Given the full list of banner-eligible events (all_day, !is_amion) and the
 * week's date strings (YYYY-MM-DD, length 7, Sunday→Saturday), produce a list
 * of grid-positioned spans with non-overlapping lane assignments.
 */
export function computeBannerSpans(
  events: CalendarEvent[],
  weekDates: string[],
): BannerSpan[] {
  const weekStart = parseISO(`${weekDates[0]}T00:00:00`)
  const weekEnd = parseISO(`${weekDates[weekDates.length - 1]}T00:00:00`)
  // weekEnd is the START of the last day (Saturday); the visible week runs
  // up to but not including the next Sunday. We compare event ranges
  // (which are [start, end) in calendar-event terms) against [weekStart, weekEnd+1day).

  const visibleEnd = new Date(weekEnd.getTime() + 24 * 60 * 60 * 1000)

  type Raw = { id: string; title: string; startCol: number; endCol: number }
  const raw: Raw[] = []

  for (const event of events) {
    // Normalize to date-only (drop time/timezone) so column math is purely calendar-date based
    const start = parseISO(`${event.start.slice(0, 10)}T00:00:00`)
    const end = parseISO(`${event.end.slice(0, 10)}T00:00:00`)

    // Skip if event ends before week starts, or starts on/after week ends
    if (!isAfter(end, weekStart)) continue
    if (!isBefore(start, visibleEnd)) continue

    // Clip to visible range
    const clippedStart = isBefore(start, weekStart) ? weekStart : start
    const clippedEnd = isAfter(end, visibleEnd) ? visibleEnd : end

    // Convert to column indices (1-based)
    const startCol = Math.floor((clippedStart.getTime() - weekStart.getTime()) / (24 * 60 * 60 * 1000)) + 1
    const endCol = Math.ceil((clippedEnd.getTime() - weekStart.getTime()) / (24 * 60 * 60 * 1000)) + 1

    raw.push({ id: event.id, title: event.title ?? '', startCol, endCol })
  }

  // Sort by startCol (then by length desc, then id) for stable lane assignment
  raw.sort((a, b) =>
    a.startCol - b.startCol
    || (b.endCol - b.startCol) - (a.endCol - a.startCol)
    || a.id.localeCompare(b.id)
  )

  // Assign lanes greedily: pack each into the lowest-numbered lane
  // whose last span ended at or before this span's start.
  const laneEnds: number[] = [] // laneEnds[i] = endCol of last span placed in lane i
  const result: BannerSpan[] = []

  for (const span of raw) {
    let lane = laneEnds.findIndex(end => end <= span.startCol)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(span.endCol)
    } else {
      laneEnds[lane] = span.endCol
    }
    result.push({ ...span, lane })
  }

  return result
}
