/**
 * The TRMNL display shows a single day (today, local Eastern time). We fetch
 * a slightly wider window so multi-day all-day banners that started before
 * today and overnight shifts that ended this morning still resolve correctly.
 */

export type DayWindow = {
  today: string       // 'YYYY-MM-DD'
  fetchStart: string  // 'YYYY-MM-DD' (today - 1)
  fetchEnd: string    // 'YYYY-MM-DD' (today + 2)
  fetchDates: string[]
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function computeDayWindow(now: Date = new Date()): DayWindow {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const today = isoDate(start)

  const before = new Date(start)
  before.setDate(start.getDate() - 1)
  const fetchStart = isoDate(before)

  const after = new Date(start)
  after.setDate(start.getDate() + 2)
  const fetchEnd = isoDate(after)

  const fetchDates: string[] = []
  const cursor = new Date(before)
  while (isoDate(cursor) <= fetchEnd) {
    fetchDates.push(isoDate(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }

  return { today, fetchStart, fetchEnd, fetchDates }
}
