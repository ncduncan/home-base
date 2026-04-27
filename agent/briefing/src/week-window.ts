/**
 * The agent runs Sunday morning ET. The "upcoming week" is Sunday → Saturday
 * inclusive (7 days). All ranges below are computed from the most recent
 * Sunday at local midnight.
 */

export type WeekWindow = {
  startDate: string  // 'YYYY-MM-DD' (Sunday)
  endDate: string    // 'YYYY-MM-DD' (Saturday)
  dates: string[]    // all 7 days, Sunday first
}

export function computeWeekWindow(now: Date = new Date()): WeekWindow {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - start.getDay()) // snap to most recent Sunday

  const dates: string[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    dates.push(d.toISOString().slice(0, 10))
  }

  return {
    startDate: dates[0],
    endDate: dates[6],
    dates,
  }
}
