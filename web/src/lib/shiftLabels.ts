import type { CalendarEvent } from '../types'

export const SHIFT_LABELS: Record<string, string> = {
  training: 'Training',
  day:      'Day Shift',
  night:    'Night Shift',
  '24hr':   '24Hr',
  backup:   'Backup',
}

export function shiftLabel(kind: CalendarEvent['amion_kind']): string {
  return SHIFT_LABELS[kind ?? ''] ?? 'Shift'
}
