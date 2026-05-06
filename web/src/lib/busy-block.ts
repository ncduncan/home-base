// Per-day per-owner block computation.
//
// Caitie: research/personal events collapse into a single earliest-start →
// latest-end block (AMION shifts and Gus events render discretely).
// Nat: a static synthetic 8am–5pm M–F block labeled "Work" — never extended
// by personal events (those render discretely).

import { parseISO } from 'date-fns'
import type { CalendarEvent } from '@home-base/shared/types'

export interface BusyBlock {
  startISO: string
  endISO: string
  /** True when endISO is on a later calendar date than startISO. */
  crossesMidnight: boolean
  /** Optional title shown above the time range (e.g. "Work" for Nat M–F). */
  label?: string
}

const NAT_WORK_START_HOUR = 8
const NAT_WORK_END_HOUR = 17

export function computeRangeBlock(events: CalendarEvent[]): BusyBlock | null {
  if (events.length === 0) return null
  const startISO = events.map(e => e.start).sort()[0]
  const endISO = events.map(e => e.end).sort().at(-1)!
  return {
    startISO,
    endISO,
    crossesMidnight: endISO.slice(0, 10) !== startISO.slice(0, 10),
  }
}

export function computeNatWorkBlock(dateStr: string): BusyBlock | null {
  const dow = parseISO(`${dateStr}T12:00:00`).getDay()
  if (dow < 1 || dow > 5) return null
  return {
    startISO: `${dateStr}T${String(NAT_WORK_START_HOUR).padStart(2, '0')}:00:00`,
    endISO:   `${dateStr}T${String(NAT_WORK_END_HOUR).padStart(2, '0')}:00:00`,
    crossesMidnight: false,
    label: 'Work',
  }
}
