import { supabase } from './supabase'
import type { CalendarEvent } from '../types'

export class CalendarAuthError extends Error {
  constructor() {
    super('Google calendar token expired — please sign out and sign back in')
    this.name = 'CalendarAuthError'
  }
}

const AMION_CALENDAR_NAME = 'Caitie Work'
const SKIP_TITLES = new Set(['Vacation', 'Leave'])

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

export async function fetchCalendarEvents(): Promise<CalendarEvent[]> {
  const token = await getProviderToken()

  const now = new Date()
  const weekEnd = new Date(now)
  weekEnd.setDate(weekEnd.getDate() + 7)

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
          timeMin: now.toISOString(),
          timeMax: weekEnd.toISOString(),
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

        return items
          .filter(e => {
            if (e.status === 'cancelled') return false
            if (!isAmion) return true
            const title = e.summary as string ?? ''
            if (SKIP_TITLES.has(title)) return false
            const start = e.start as Record<string, string> ?? {}
            const allDay = 'date' in start && !('dateTime' in start)
            if (allDay && e.recurringEventId) return false
            return true
          })
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
              is_amion: isAmion,
            } as CalendarEvent
          })
      })
  )

  const sorted = results.flat().sort((a, b) => a.start.localeCompare(b.start))

  // Cache events in Supabase for TRMNL e-ink display (fire and forget)
  void supabase.from('calendar_cache').upsert(
    sorted.map(e => ({
      id: e.id,
      title: e.title,
      start_time: e.start,
      end_time: e.end,
      all_day: e.all_day,
      location: e.location,
      calendar_name: e.calendar_name,
      is_amion: e.is_amion,
      cached_at: new Date().toISOString(),
    })),
    { onConflict: 'id' }
  )
  // Prune past events
  void supabase.from('calendar_cache').delete().lt('start_time', new Date().toISOString())

  return sorted
}
