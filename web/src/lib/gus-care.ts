import type { CalendarEvent, GusResponsibility } from '../types'
import { eventOwner } from './calendar'

function isWeekend(dateStr: string): boolean {
  const day = new Date(`${dateStr}T12:00:00`).getDay()
  return day === 0 || day === 6
}

function prevDay(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`)
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

const SHIFT_LABELS: Record<string, string> = {
  training: 'Training',
  day: 'Day Shift',
  night: 'Night Shift',
  '24hr': '24Hr',
  backup: 'Backup',
}

const DROPOFF_HOUR = 7 // 7am
const PICKUP_HOUR = 17 // 5pm

/**
 * Compute Gus pickup/dropoff responsibilities from the (overridden) event list.
 *
 * Considers ALL events owned by Caitie (AMION shifts + her regular Google Calendar
 * events). Overrides are already applied upstream in DashboardPage before this runs.
 *
 * Caitie is on point unless she's actually busy at the relevant hour:
 * - Pickup at 5pm: Caitie unless any of her events covers 5pm OR starts within
 *   ~2 hours of 5pm (commute prep)
 * - Dropoff at 7am: Caitie unless she has an event starting by 9am today (leaving
 *   early), OR an event from yesterday running past 7am today
 */
export function computeGusCare(events: CalendarEvent[]): GusResponsibility[] {
  // Group Caitie's events by start date (AMION shifts + her regular events).
  // Skip "backup" AMION shifts — they don't make her unavailable.
  const caitieByDate = new Map<string, CalendarEvent[]>()
  for (const event of events) {
    if (eventOwner(event) !== 'caitie') continue
    if (event.is_amion && event.amion_kind === 'backup') continue
    const dateStr = event.start.slice(0, 10)
    const existing = caitieByDate.get(dateStr) ?? []
    existing.push(event)
    caitieByDate.set(dateStr, existing)
  }

  // All weekdays in the event list range
  const allDates = new Set<string>()
  for (const event of events) {
    allDates.add(event.start.slice(0, 10))
  }

  const results: GusResponsibility[] = []

  for (const dateStr of [...allDates].sort()) {
    if (isWeekend(dateStr)) continue

    const dayEvents = caitieByDate.get(dateStr) ?? []
    const prevEvents = caitieByDate.get(prevDay(dateStr)) ?? []

    // Pickup at 5pm: Nat if any of Caitie's events covers 5pm
    const natPickup = dayEvents.some(coversPickup)

    // Dropoff at 7am: Nat if Caitie has an early event today OR overnight event from yesterday
    const natDropoffEarly = dayEvents.some(e => startsByMorning(e, dateStr))
    const natDropoffOvernight = prevEvents.some(e => runsPastTodayMorning(e, dateStr))
    const natDropoff = natDropoffEarly || natDropoffOvernight

    // Build reason string
    const reasons: string[] = []
    for (const e of dayEvents) {
      if (e.is_amion && e.amion_kind) {
        reasons.push(SHIFT_LABELS[e.amion_kind] ?? e.amion_kind)
      } else {
        reasons.push(e.title)
      }
    }
    if (natDropoffOvernight && !natDropoffEarly) reasons.push('post-overnight')
    const reason = reasons.length > 0 ? `Caitie: ${reasons.join(', ')}` : 'Caitie off'

    results.push({
      date: dateStr,
      pickup: natPickup ? 'nat' : 'caitie',
      dropoff: natDropoff ? 'nat' : 'caitie',
      reason,
    })
  }

  return results
}

// Does this event make Caitie unavailable at 5pm on its start date?
function coversPickup(event: CalendarEvent): boolean {
  if (event.all_day) return true // all-day commitment

  const startHour = hourOf(event.start)
  const endDate = event.end.slice(0, 10)
  const startDate = event.start.slice(0, 10)
  const endHour = hourOf(event.end)

  // Multi-day shift (night, 24hr) starting today: covers 5pm if it starts at/before 7pm
  if (endDate !== startDate) {
    return startHour <= PICKUP_HOUR + 2
  }

  // Same-day: covers 5pm if [start, end) contains 5pm, OR starts within 2hr after 5pm
  if (startHour <= PICKUP_HOUR && endHour > PICKUP_HOUR) return true
  if (startHour > PICKUP_HOUR && startHour <= PICKUP_HOUR + 2) return true
  return false
}

// Does this event start at or before 9am today, meaning Caitie is leaving early?
function startsByMorning(event: CalendarEvent, dateStr: string): boolean {
  if (event.start.slice(0, 10) !== dateStr) return false
  if (event.all_day) return true
  return hourOf(event.start) <= 9
}

// Was this event (from yesterday) still running at 7am this morning?
function runsPastTodayMorning(event: CalendarEvent, todayStr: string): boolean {
  const endDate = event.end.slice(0, 10)
  if (endDate !== todayStr) return false
  if (event.all_day) return false
  return hourOf(event.end) > DROPOFF_HOUR
}

function hourOf(isoStr: string): number {
  return parseInt(isoStr.slice(11, 13), 10)
}
