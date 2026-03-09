import { supabase } from './supabase'
import type { CalendarEvent } from '../types'

export class CalendarAuthError extends Error {
  constructor() {
    super('Google calendar token expired — please sign out and sign back in')
    this.name = 'CalendarAuthError'
  }
}

const AMION_CALENDAR_NAME = 'Caitie Work'

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

type AmionType = 'skip' | 'vacation' | 'am' | 'pm' | 'backup' | 'call' | 'rotation'

function classifyAmionTitle(title: string): AmionType {
  if (/^Week\s+\d/i.test(title)) return 'skip'
  if (/^(vacation|leave)$/i.test(title)) return 'vacation'
  if (title.startsWith('AM:')) return 'am'
  if (title.startsWith('PM:')) return 'pm'
  if (title.includes('SC')) return 'backup'
  if (title.startsWith('Call:')) return 'call'
  return 'rotation'
}

function isWeekend(dateStr: string): boolean {
  // Parse as local date using noon to avoid DST edge cases
  const d = new Date(`${dateStr}T12:00:00`)
  const day = d.getDay()
  return day === 0 || day === 6
}

function localDT(dateStr: string, hours: number, minutes = 0): string {
  const hh = String(hours).padStart(2, '0')
  const mm = String(minutes).padStart(2, '0')
  return `${dateStr}T${hh}:${mm}:00`
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

function processAmionEvents(
  rawItems: Array<Record<string, unknown>>,
  calId: string,
): CalendarEvent[] {
  // Classify and group by date
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

    let emittedWorking = false

    // 1. Vacation / Leave → all-day vacation block
    if (vacations.length > 0) {
      results.push({
        id: `amion-vac-${dateStr}`,
        title: 'Vacation',
        start: localDT(dateStr, 0),
        end: localDT(dateStr, 0),
        location: null,
        all_day: true,
        calendar_name: calId,
        is_amion: true,
        amion_kind: 'vacation',
      })
      emittedWorking = true
    }

    // 2. AM: half-day morning
    for (const e of ams) {
      results.push({
        id: (e.raw.id as string) ?? `amion-am-${dateStr}`,
        title: '',
        start: localDT(dateStr, 8),
        end: localDT(dateStr, 12),
        location: null,
        all_day: false,
        calendar_name: calId,
        is_amion: true,
        amion_kind: 'working',
      })
      emittedWorking = true
    }

    // 3. PM: half-day afternoon
    for (const e of pms) {
      results.push({
        id: (e.raw.id as string) ?? `amion-pm-${dateStr}`,
        title: '',
        start: localDT(dateStr, 13),
        end: localDT(dateStr, 17),
        location: null,
        all_day: false,
        calendar_name: calId,
        is_amion: true,
        amion_kind: 'working',
      })
      emittedWorking = true
    }

    // 4. Rotation blocks
    if (rotations.length > 0) {
      if (isWeekend(dateStr)) {
        if (calls.length > 0) {
          // Weekend rotation + call → 24h On Call shift
          results.push({
            id: `amion-oncall-${dateStr}`,
            title: '',
            start: localDT(dateStr, 8),
            end: localDT(nextDay(dateStr), 8),
            location: null,
            all_day: false,
            calendar_name: calId,
            is_amion: true,
            amion_kind: 'oncall',
          })
          emittedWorking = true
        }
        // else: weekend rotation with no call → skip (she's off)
      } else {
        // Weekday rotation → standard shift
        results.push({
          id: `amion-rot-${dateStr}`,
          title: '',
          start: localDT(dateStr, 8),
          end: localDT(dateStr, 18),
          location: null,
          all_day: false,
          calendar_name: calId,
          is_amion: true,
          amion_kind: 'working',
        })
        emittedWorking = true
      }
    }

    // 5. Standalone call (no rotation on this day) → she goes in
    if (calls.length > 0 && rotations.length === 0 && !emittedWorking) {
      results.push({
        id: `amion-call-${dateStr}`,
        title: '',
        start: localDT(dateStr, 8),
        end: localDT(dateStr, 18),
        location: null,
        all_day: false,
        calendar_name: calId,
        is_amion: true,
        amion_kind: 'working',
      })
      emittedWorking = true
    }

    // 6. Backup (SC) — only if nothing working/oncall/vacation was emitted
    if (backups.length > 0 && !emittedWorking) {
      results.push({
        id: `amion-backup-${dateStr}`,
        title: '',
        start: localDT(dateStr, 0),
        end: localDT(dateStr, 0),
        location: null,
        all_day: true,
        calendar_name: calId,
        is_amion: true,
        amion_kind: 'backup',
      })
    }
  }

  return results
}

// ── Main fetch ─────────────────────────────────────────────────────────────────

export async function fetchCalendarEvents(weekOffset = 0): Promise<CalendarEvent[]> {
  const token = await getProviderToken()

  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const timeMin = new Date(now)
  timeMin.setDate(timeMin.getDate() + weekOffset * 7)
  const timeMax = new Date(timeMin)
  timeMax.setDate(timeMax.getDate() + 7)

  const listResp = await fetch(
    'https://www.googleapis.com/calendar/v3/users/me/calendarList',
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!listResp.ok) throw new Error('Failed to fetch calendar list')
  const { items: calendars = [] } = await listResp.json() as { items: Array<{ id: string; summary: string; selected?: boolean }> }

  const results = await Promise.all(
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
        if (!resp.ok) return [] as CalendarEvent[]

        const { items = [] } = await resp.json() as { items: Array<Record<string, unknown>> }
        const isAmion = cal.summary === AMION_CALENDAR_NAME

        if (isAmion) {
          return processAmionEvents(items, cal.summary)
        }

        return items
          .filter(e => e.status !== 'cancelled')
          .map(e => {
            const start = e.start as Record<string, string> ?? {}
            const end = e.end as Record<string, string> ?? {}
            const allDay = 'date' in start && !('dateTime' in start)
            return {
              id: e.id as string,
              title: (e.summary as string) ?? '(No title)',
              start: allDay ? `${start.date}T00:00:00` : start.dateTime,
              end: allDay ? `${end.date}T00:00:00` : end.dateTime,
              location: (e.location as string) ?? null,
              all_day: allDay,
              calendar_name: cal.summary,
              is_amion: false,
            } as CalendarEvent
          })
      })
  )

  return results.flat().sort((a, b) => a.start.localeCompare(b.start))
}
