import type { CalendarEvent, GusResponsibility } from '../types'

function isWeekend(dateStr: string): boolean {
  const day = new Date(`${dateStr}T12:00:00`).getDay()
  return day === 0 || day === 6
}

const SHIFT_LABELS: Record<string, string> = {
  training: 'Training',
  day: 'Day Shift',
  night: 'Night Shift',
  '24hr': '24Hr',
  backup: 'Backup',
}

/**
 * Compute Gus pickup/dropoff responsibilities from the (overridden) event list.
 *
 * Rules:
 * - Pickup (afternoon): Nat whenever Caitie has a non-backup AMION weekday event
 * - Dropoff (morning): Nat when Caitie has day/training/24hr that day (she leaves by 8am),
 *   OR Caitie had night/24hr the *previous* day (still at hospital at 7am)
 * - Otherwise Caitie handles it
 */
export function computeGusCare(events: CalendarEvent[]): GusResponsibility[] {
  // Collect AMION events by date
  const amionByDate = new Map<string, CalendarEvent[]>()
  for (const event of events) {
    if (!event.is_amion) continue
    const dateStr = event.start.slice(0, 10)
    const existing = amionByDate.get(dateStr) ?? []
    existing.push(event)
    amionByDate.set(dateStr, existing)
  }

  // Collect all dates in the events range
  const allDates = new Set<string>()
  for (const event of events) {
    allDates.add(event.start.slice(0, 10))
  }

  const results: GusResponsibility[] = []

  for (const dateStr of [...allDates].sort()) {
    if (isWeekend(dateStr)) continue

    const dayAmion = amionByDate.get(dateStr) ?? []

    // Pickup: Nat whenever Caitie has a non-backup AMION event this weekday
    const hasWork = dayAmion.some(e => e.amion_kind && e.amion_kind !== 'backup')
    const pickup: 'nat' | 'caitie' = hasWork ? 'nat' : 'caitie'

    // Dropoff: check if Caitie leaves early today or is still at hospital from last night
    const hasEarlyShift = dayAmion.some(e =>
      e.amion_kind === 'day' || e.amion_kind === 'training' || e.amion_kind === '24hr'
    )

    // Check previous day for overnight shifts
    const prevDateStr = prevDay(dateStr)
    const prevAmion = amionByDate.get(prevDateStr) ?? []
    const hadOvernightYesterday = prevAmion.some(e =>
      e.amion_kind === 'night' || e.amion_kind === '24hr'
    )

    const natDropoff = hasEarlyShift || hadOvernightYesterday
    const dropoff: 'nat' | 'caitie' = natDropoff ? 'nat' : 'caitie'

    // Build reason string
    const reasons: string[] = []
    for (const e of dayAmion) {
      if (e.amion_kind && e.amion_kind !== 'backup') {
        reasons.push(SHIFT_LABELS[e.amion_kind] ?? e.amion_kind)
      }
    }
    if (hadOvernightYesterday && !hasEarlyShift) {
      reasons.push('post-night')
    }
    const reason = reasons.length > 0
      ? `Caitie: ${reasons.join(', ')}`
      : 'Caitie off'

    results.push({ date: dateStr, pickup, dropoff, reason })
  }

  return results
}

function prevDay(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`)
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}
