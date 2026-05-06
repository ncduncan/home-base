// Per-day per-owner "busy block" computation. Replaces individual timed-event
// rendering with a single block from earliest start to latest end.
//
// Nat gets a synthetic 8am-5pm baseline on weekdays so the dashboard reflects
// his typical work hours without requiring a corresponding Google Calendar
// event. The baseline lives only in this helper — never written to Google.

import { parseISO } from 'date-fns'
import type { CalendarEvent } from '@home-base/shared/types'

export interface BusyBlock {
  startISO: string
  endISO: string
  /** True when endISO is on a later calendar date than startISO. */
  crossesMidnight: boolean
}

const NAT_WORK_START_HOUR = 8
const NAT_WORK_END_HOUR = 17

export function computeBusyBlock(
  busyEvents: CalendarEvent[],
  owner: 'nat' | 'caitie',
  dateStr: string,
): BusyBlock | null {
  const candidates: { start: string; end: string }[] = busyEvents.map(e => ({ start: e.start, end: e.end }))

  if (owner === 'nat') {
    const dow = parseISO(`${dateStr}T12:00:00`).getDay()
    if (dow >= 1 && dow <= 5) {
      candidates.push({
        start: `${dateStr}T${String(NAT_WORK_START_HOUR).padStart(2, '0')}:00:00`,
        end:   `${dateStr}T${String(NAT_WORK_END_HOUR).padStart(2, '0')}:00:00`,
      })
    }
  }

  if (candidates.length === 0) return null

  const startISO = candidates.map(c => c.start).sort()[0]
  const endISO = candidates.map(c => c.end).sort().at(-1)!
  const crossesMidnight = endISO.slice(0, 10) !== startISO.slice(0, 10)

  return { startISO, endISO, crossesMidnight }
}
