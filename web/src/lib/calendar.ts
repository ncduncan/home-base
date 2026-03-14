import { supabase } from './supabase'
import type { CalendarEvent } from '../types'

export class CalendarAuthError extends Error {
  constructor() {
    super('Google calendar token expired — please sign out and sign back in')
    this.name = 'CalendarAuthError'
  }
}

async function getProviderToken(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  let token = data.session?.provider_token
  if (!token) {
    const { data: refreshed } = await supabase.auth.refreshSession()
    token = refreshed.session?.provider_token
  }
  if (!token) throw new CalendarAuthError()
  return token
}

// ── AMION helpers ──────────────────────────────────────────────────────────────

type AmionType = 'skip' | 'vacation' | 'am' | 'pm' | 'backup' | 'nc-pool' | 'nc-call' | 'call' | 'rotation'

function classifyAmionTitle(title: string): AmionType {
  if (/^Week\s+\d/i.test(title)) return 'skip'
  if (/^(vacation|leave)$/i.test(title)) return 'vacation'
  if (title.startsWith('AM:')) return 'am'
  if (title.startsWith('PM:')) return 'pm'
  if (title.includes('SC')) return 'backup'
  if (/^Call:\s*NC-/i.test(title)) return 'nc-call'  // check before general NC-
  if (/^NC-/i.test(title)) return 'nc-pool'           // NC- pool blocks: only shown with nc-call
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

function processAmionEvents(rawItems: Array<Record<string, unknown>>): CalendarEvent[] {
  const byDate = new Map<string, { type: AmionType; raw: Record<string, unknown> }[]>()

  for (const item of rawItems) {
    if (item.status === 'cancelled') continue
    const title = (item.summary as string) ?? ''
    const type = classifyAmionTitle(title)
    if (type === 'skip') continue
    const dateStr = getDateStr(item)
    if (!dateStr) continue
    const group = byDate.get(dateStr) ?? []
    group.push({ type, raw: item })
    byDate.set(dateStr, group)
  }

  const results: CalendarEvent[] = []

  for (const [dateStr, entries] of byDate) {
    const vacations = entries.filter(e => e.type === 'vacation')
    const rotations = entries.filter(e => e.type === 'rotation')
    const calls     = entries.filter(e => e.type === 'call')
    const backups   = entries.filter(e => e.type === 'backup')
    const ams       = entries.filter(e => e.type === 'am')
    const pms       = entries.filter(e => e.type === 'pm')
    const ncCalls   = entries.filter(e => e.type === 'nc-call')
    // nc-pool entries are intentionally ignored unless ncCalls is non-empty

    let emittedWorking = false

    // 1. Vacation / Leave — not shown
    if (vacations.length > 0) {
      emittedWorking = true
    }

    // 2. Night call (Call: NC-X) → Night Shift 6pm–8am next day
    if (ncCalls.length > 0) {
      results.push({
        id: `amion-nccall-${dateStr}`,
        title: '',
        start: localDT(dateStr, 18),
        end: localDT(nextDay(dateStr), 8),
        location: null,
        all_day: false,
        calendar_name: 'Caitie Work',
        is_amion: true,
        amion_kind: 'night',
      })
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

    // 5. Regular rotation blocks (non-NC-prefixed)
    if (rotations.length > 0) {
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
  if (event.is_amion) return 'caitie'
  if (event.organizer_email === 'caitante@gmail.com') return 'caitie'
  return 'nat'
}

// ── Main fetch ─────────────────────────────────────────────────────────────────

export async function fetchCalendarEvents(weekOffset = 0): Promise<CalendarEvent[]> {
  const token = await getProviderToken()

  const now = new Date()
  now.setHours(0, 0, 0, 0)
  // Snap to the most recent Sunday so the week is always Sun–Sat
  now.setDate(now.getDate() - now.getDay())
  const timeMin = new Date(now)
  timeMin.setDate(timeMin.getDate() + weekOffset * 7)
  const timeMax = new Date(timeMin)
  timeMax.setDate(timeMax.getDate() + 7)

  const listResp = await fetch(
    'https://www.googleapis.com/calendar/v3/users/me/calendarList',
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!listResp.ok) throw new Error('Failed to fetch calendar list')
  const { items: calendars = [] } = await listResp.json() as {
    items: Array<{ id: string; summary: string; selected?: boolean }>
  }

  const calendarData = await Promise.all(
    calendars
      .filter(cal => cal.selected !== false)
      .map(async cal => {
        const params = new URLSearchParams({
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: '250',
        })
        const resp = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${params}`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        if (!resp.ok) return { cal, items: [] as Array<Record<string, unknown>> }
        const { items = [] } = await resp.json() as { items: Array<Record<string, unknown>> }
        return { cal, items }
      })
  )

  // Detect AMION events by iCalUID (contains '@amion.com') — reliable regardless of calendar name
  const amionItems: Array<Record<string, unknown>> = []
  const regularEvents: CalendarEvent[] = []

  for (const { cal, items } of calendarData) {
    for (const item of items) {
      const uid = (item.iCalUID as string) ?? ''
      if (uid.includes('@amion.com')) {
        amionItems.push(item)
        continue
      }
      if (item.status === 'cancelled') continue
      const title = (item.summary as string) ?? ''
      if (/^Week\s+\d+\s+of/i.test(title)) continue  // skip "Week N of YYYY" globally
      const start = item.start as Record<string, string> ?? {}
      const end = item.end as Record<string, string> ?? {}
      const allDay = 'date' in start && !('dateTime' in start)
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
      })
    }
  }

  const amionEvents = processAmionEvents(amionItems)
  return [...regularEvents, ...amionEvents].sort((a, b) => a.start.localeCompare(b.start))
}

// ── Gus pickup invites ─────────────────────────────────────────────────────────

export async function createGusPickupEvents(): Promise<void> {
  const token = await getProviderToken()

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const threeMonthsOut = new Date(today)
  threeMonthsOut.setDate(threeMonthsOut.getDate() + 90)

  // Fetch Caitie's work days (~13 weeks) and existing Gus pickup events in parallel
  const weekFetches = Array.from({ length: 13 }, (_, i) => fetchCalendarEvents(i))
  const [listResp, ...weekResults] = await Promise.all([
    fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
      new URLSearchParams({
        q: 'Gus pickup',
        timeMin: today.toISOString(),
        timeMax: threeMonthsOut.toISOString(),
        singleEvents: 'true',
        maxResults: '100',
      }),
      { headers: { Authorization: `Bearer ${token}` } }
    ),
    ...weekFetches,
  ])

  // Build set of Caitie work days
  const workDays = new Set<string>()
  for (const event of weekResults.flat()) {
    if (!event.is_amion) continue
    if (event.amion_kind === 'backup') continue
    const dateStr = event.start.slice(0, 10)
    const date = new Date(`${dateStr}T12:00:00`)
    if (date >= today && date < threeMonthsOut && !isWeekend(dateStr)) {
      workDays.add(dateStr)
    }
  }

  // Build map of existing Gus pickup events: dateStr → eventId
  const existingPickups = new Map<string, string>()
  if (listResp.ok) {
    const { items = [] } = await listResp.json() as { items: Array<{ id: string; summary?: string; start?: { dateTime?: string; date?: string } }> }
    for (const item of items) {
      if (item.summary !== 'Gus pickup') continue
      const startStr = item.start?.dateTime ?? item.start?.date ?? ''
      const dateStr = startStr.slice(0, 10)
      if (dateStr) existingPickups.set(dateStr, item.id)
    }
  }

  await Promise.all([
    // Cancel pickups on days Caitie is no longer working
    ...[...existingPickups.entries()]
      .filter(([dateStr]) => !workDays.has(dateStr))
      .map(async ([dateStr, eventId]) => {
        const resp = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
          { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
        )
        if (!resp.ok && resp.status !== 410) {
          console.warn(`Failed to cancel Gus pickup for ${dateStr}:`, resp.status)
        }
      }),

    // Create pickups for work days that don't have one yet
    ...[...workDays]
      .filter(dateStr => !existingPickups.has(dateStr))
      .map(async dateStr => {
        const resp = await fetch(
          'https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              id: `guspickup${dateStr.replace(/-/g, '')}`,
              summary: 'Gus pickup',
              start: { dateTime: `${dateStr}T17:00:00`, timeZone: 'America/New_York' },
              end:   { dateTime: `${dateStr}T18:00:00`, timeZone: 'America/New_York' },
              attendees: [{ email: 'nathaniel.duncan@geaerospace.com' }],
            }),
          }
        )
        if (!resp.ok && resp.status !== 409) {
          console.warn(`Failed to create Gus pickup for ${dateStr}:`, resp.status)
        }
      }),
  ])
}
