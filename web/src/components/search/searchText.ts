import { shiftLabel } from '@/lib/shiftLabels'
import type { AsanaTask, CalendarEvent } from '../../types'

export function eventSearchText(e: CalendarEvent): string {
  const title = e.is_amion ? shiftLabel(e.amion_kind) : e.title
  return [title, e.location, e.calendar_name, e.notes]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

export function taskSearchText(t: AsanaTask): string {
  return [t.name, t.notes, t.assignee?.name, ...(t.projects ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

export function eventDisplayTitle(e: CalendarEvent): string {
  if (e.is_amion) return `${shiftLabel(e.amion_kind)} · ${e.calendar_name}`
  return e.title || e.calendar_name || '(untitled event)'
}

/**
 * Compute the dashboard weekOffset that would render the given ISO date in its
 * Sun→Sat column. 0 = this week, positive = future, negative = past.
 */
export function weekOffsetForDate(dateISO: string): number {
  const sunday = new Date()
  sunday.setHours(0, 0, 0, 0)
  sunday.setDate(sunday.getDate() - sunday.getDay())
  const resultDate = new Date(`${dateISO}T12:00:00`)
  return Math.floor((resultDate.getTime() - sunday.getTime()) / (7 * 24 * 3600 * 1000))
}
