import type { CalendarEvent } from '../types.ts'

// ── AMION helpers ──────────────────────────────────────────────────────────────

type AmionType = 'skip' | 'vacation' | 'am' | 'pm' | 'backup' | 'nc-pool' | 'nc-call' | 'call' | 'rotation'

function classifyAmionTitle(title: string): AmionType {
  if (/^Week\s+\d/i.test(title)) return 'skip'
  if (/^(vacation|leave)$/i.test(title)) return 'vacation'
  if (title.startsWith('AM:')) return 'am'
  if (title.startsWith('PM:')) return 'pm'
  if (/^Call:\s*NC-/i.test(title)) return 'nc-call'  // before SC check — NC-call titles may contain 'SC'
  if (/^NC-/i.test(title)) return 'nc-pool'           // before SC check — same reason
  if (title.includes('SC')) return 'backup'
  if (title.startsWith('Call:')) return 'call'
  return 'rotation'
}

function isWeekend(dateStr: string): boolean {
  const day = new Date(`${dateStr}T12:00:00`).getDay()
  return day === 0 || day === 6
}

function localDT(dateStr: string, hours: number, minutes = 0): string {
  return `${dateStr}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`
}

function nextDay(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`)
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

function getDateStr(e: Record<string, unknown>): string {
  const start = e.start as Record<string, string> ?? {}
  return start.date ?? (start.dateTime ?? '').slice(0, 10)
}

// Expand a multi-day all-day event into the list of dates it covers.
// For all-day events Google uses an exclusive end.date, so a Mon→next-Mon
// event covers Mon through Sun (7 days). Timed events stay on their start day.
function getCoveredDates(e: Record<string, unknown>): string[] {
  const start = e.start as Record<string, string> ?? {}
  const end = e.end as Record<string, string> ?? {}
  if (start.date && end.date && end.date > start.date) {
    const dates: string[] = []
    let cur = start.date
    while (cur < end.date) {
      dates.push(cur)
      cur = nextDay(cur)
    }
    return dates
  }
  const single = getDateStr(e)
  return single ? [single] : []
}

export function processAmionEvents(rawItems: Array<Record<string, unknown>>): CalendarEvent[] {
  const byDate = new Map<string, { type: AmionType; raw: Record<string, unknown> }[]>()

  for (const item of rawItems) {
    if (item.status === 'cancelled') continue
    const title = (item.summary as string) ?? ''
    const type = classifyAmionTitle(title)
    if (type === 'skip') continue
    // Expand multi-day all-day events (e.g. an SC1 backup block spanning a
    // whole week) so each day of the span gets the marker — otherwise only
    // the start day would emit a shift.
    for (const dateStr of getCoveredDates(item)) {
      const group = byDate.get(dateStr) ?? []
      group.push({ type, raw: item })
      byDate.set(dateStr, group)
    }
  }

  const results: CalendarEvent[] = []

  for (const [dateStr, entries] of byDate) {
    const vacations = entries.filter(e => e.type === 'vacation')
    // NC-pool (e.g. "NC-11H" alone) is just a *block marker* — Caitie isn't actually
    // working that day. Only "Call: NC-X" represents an actual working shift.
    // Real rotations (CICU, BWH ICU, etc.) still emit day shifts.
    const rotations = entries.filter(e => e.type === 'rotation')
    const calls     = entries.filter(e => e.type === 'call')
    const backups   = entries.filter(e => e.type === 'backup')
    const ams       = entries.filter(e => e.type === 'am')
    const pms       = entries.filter(e => e.type === 'pm')
    const ncCalls   = entries.filter(e => e.type === 'nc-call')

    let emittedWorking = false

    // 1. Vacation / Leave — not shown
    if (vacations.length > 0) {
      emittedWorking = true
    }

    // 2. Night call (Call: NC-X) — the only "real" shift in an NC block
    //    • Weekday  → 4pm to 8am next day (16-hour night shift)
    //    • Weekend  → 8am to 8am next day (24-hour shift)
    if (ncCalls.length > 0) {
      if (isWeekend(dateStr)) {
        results.push({
          id: `amion-nccall-${dateStr}`,
          title: '',
          start: localDT(dateStr, 8),
          end: localDT(nextDay(dateStr), 8),
          location: null,
          all_day: false,
          calendar_name: 'Caitie Work',
          is_amion: true,
          amion_kind: '24hr',
        })
      } else {
        results.push({
          id: `amion-nccall-${dateStr}`,
          title: '',
          start: localDT(dateStr, 16),  // 4pm
          end: localDT(nextDay(dateStr), 8),
          location: null,
          all_day: false,
          calendar_name: 'Caitie Work',
          is_amion: true,
          amion_kind: 'night',
        })
      }
      emittedWorking = true
    }

    // 3. AM: half-day morning → Training
    for (const e of ams) {
      results.push({
        id: (e.raw.id as string) ?? `amion-am-${dateStr}`,
        title: '',
        start: localDT(dateStr, 8),
        end: localDT(dateStr, 12),
        location: null,
        all_day: false,
        calendar_name: 'Caitie Work',
        is_amion: true,
        amion_kind: 'training',
      })
      emittedWorking = true
    }

    // 4. PM: half-day afternoon → Training
    for (const e of pms) {
      results.push({
        id: (e.raw.id as string) ?? `amion-pm-${dateStr}`,
        title: '',
        start: localDT(dateStr, 13),
        end: localDT(dateStr, 17),
        location: null,
        all_day: false,
        calendar_name: 'Caitie Work',
        is_amion: true,
        amion_kind: 'training',
      })
      emittedWorking = true
    }

    // 5. Rotation blocks — only when nc-call didn't already handle this day
    if (rotations.length > 0 && ncCalls.length === 0) {
      if (isWeekend(dateStr)) {
        if (calls.length > 0) {
          // Weekend rotation + call → 24Hr shift
          results.push({
            id: `amion-oncall-${dateStr}`,
            title: '',
            start: localDT(dateStr, 8),
            end: localDT(nextDay(dateStr), 8),
            location: null,
            all_day: false,
            calendar_name: 'Caitie Work',
            is_amion: true,
            amion_kind: '24hr',
          })
          emittedWorking = true
        }
        // else: weekend rotation, no call → off, emit nothing
      } else {
        // Weekday rotation → Day Shift
        results.push({
          id: `amion-rot-${dateStr}`,
          title: '',
          start: localDT(dateStr, 8),
          end: localDT(dateStr, 18),
          location: null,
          all_day: false,
          calendar_name: 'Caitie Work',
          is_amion: true,
          amion_kind: 'day',
        })
        emittedWorking = true
      }
    }

    // 6. Standalone regular call (no rotation on this day) → Day Shift
    if (calls.length > 0 && rotations.length === 0 && !emittedWorking) {
      results.push({
        id: `amion-call-${dateStr}`,
        title: '',
        start: localDT(dateStr, 8),
        end: localDT(dateStr, 18),
        location: null,
        all_day: false,
        calendar_name: 'Caitie Work',
        is_amion: true,
        amion_kind: 'day',
      })
      emittedWorking = true
    }

    // 7. Backup (SC) — only if nothing else was emitted
    if (backups.length > 0 && !emittedWorking) {
      results.push({
        id: `amion-backup-${dateStr}`,
        title: '',
        start: localDT(dateStr, 0),
        end: localDT(dateStr, 0),
        location: null,
        all_day: true,
        calendar_name: 'Caitie Work',
        is_amion: true,
        amion_kind: 'backup',
      })
    }
  }

  return results
}

// ── Event owner ────────────────────────────────────────────────────────────────

export function eventOwner(event: CalendarEvent): 'nat' | 'caitie' {
  if (event.homebase_owner) return event.homebase_owner
  if (event.is_amion) return 'caitie'
  if (event.organizer_email === 'caitante@gmail.com') return 'caitie'
  return 'nat'
}

// ── Parsing raw Google Calendar items into CalendarEvent ──────────────────────

export type RawCalendarSource = {
  cal: { id: string; summary: string; summaryOverride?: string; selected?: boolean }
  items: Array<Record<string, unknown>>
}

/**
 * Parse a list of Google Calendar API responses (per source calendar) into
 * the unified CalendarEvent[] used throughout the app. AMION events are
 * detected by iCalUID OR by the source calendar being the AMION feed, then
 * routed through processAmionEvents().
 */
export function parseCalendarSources(sources: RawCalendarSource[]): CalendarEvent[] {
  const amionItems: Array<Record<string, unknown>> = []
  const regularEvents: CalendarEvent[] = []

  for (const { cal, items } of sources) {
    const calName = (cal.summary ?? '').toLowerCase()
    const calOverride = (cal.summaryOverride ?? '').toLowerCase()
    const isAmionCalendar =
      calName.includes('amion.com') ||
      calOverride === 'caitie work' ||
      calName === 'caitie work'

    for (const item of items) {
      const uid = (item.iCalUID as string) ?? ''
      if (isAmionCalendar || uid.includes('@amion.com')) {
        amionItems.push(item)
        continue
      }
      if (item.status === 'cancelled') continue
      const title = (item.summary as string) ?? ''
      if (/^Week\s+\d+\s+of/i.test(title)) continue  // skip "Week N of YYYY" globally
      if (title === 'Gus pickup' || title === 'Gus dropoff') continue  // hide auto-synced gus events
      const start = item.start as Record<string, string> ?? {}
      const end = item.end as Record<string, string> ?? {}
      const allDay = 'date' in start && !('dateTime' in start)
      const extProps = item.extendedProperties as { private?: Record<string, string> } | undefined
      const homebaseOwner = extProps?.private?.homebase_owner as 'nat' | 'caitie' | undefined
      regularEvents.push({
        id: item.id as string,
        title: title || '(No title)',
        start: allDay ? `${start.date}T00:00:00` : start.dateTime,
        end: allDay ? `${end.date}T00:00:00` : end.dateTime,
        location: (item.location as string) ?? null,
        all_day: allDay,
        calendar_name: cal.summary,
        is_amion: false,
        organizer_email: (item.organizer as { email?: string } | undefined)?.email,
        homebase_owner: homebaseOwner,
      })
    }
  }

  const amionEvents = processAmionEvents(amionItems)
  return [...regularEvents, ...amionEvents].sort((a, b) => a.start.localeCompare(b.start))
}
