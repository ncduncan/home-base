import { supabase } from './supabase'
import type { CalendarEvent } from '../types'

export class CalendarAuthError extends Error {
  constructor() {
    super('Google calendar token expired — please sign out and sign back in')
    this.name = 'CalendarAuthError'
  }
}

// ── Token cache ───────────────────────────────────────────────────────────────

let cachedToken: string | null = null
let cachedTokenExpiry = 0 // epoch ms

export function resetProviderTokenCache(): void {
  cachedToken = null
  cachedTokenExpiry = 0
}

// Reset the cache whenever Supabase emits a new session — keeps us from
// holding a stale Google access_token after a silent refresh or re-login.
supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'SIGNED_OUT') {
    resetProviderTokenCache()
  }
})

async function getProviderToken(): Promise<string> {
  // 1. Use cached token if still valid (5-min buffer)
  if (cachedToken && Date.now() < cachedTokenExpiry - 5 * 60_000) {
    return cachedToken
  }

  // 2. Try the session's provider_token (available right after OAuth login)
  const { data } = await supabase.auth.getSession()
  const sessionToken = data.session?.provider_token
  if (sessionToken) {
    cachedToken = sessionToken
    cachedTokenExpiry = Date.now() + 55 * 60_000 // assume ~1hr lifetime
    return sessionToken
  }

  // 3. Exchange refresh token via edge function
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
  const url = `${supabaseUrl}/functions/v1/google-token-refresh`

  const callEdgeFn = async (jwt: string) => {
    return fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}` },
    })
  }

  // Get a fresh Supabase JWT — refresh if needed so we don't hit the edge fn
  // with an expired one (the most common cause of "Invalid JWT" 401s).
  const getJwt = async (forceRefresh = false): Promise<string | null> => {
    if (forceRefresh) {
      const { data: refreshed } = await supabase.auth.refreshSession()
      return refreshed.session?.access_token ?? null
    }
    const { data: current } = await supabase.auth.getSession()
    return current.session?.access_token ?? null
  }

  let jwt = await getJwt()
  if (!jwt) {
    jwt = await getJwt(true)
    if (!jwt) throw new CalendarAuthError()
  }

  let resp: Response
  try {
    resp = await callEdgeFn(jwt)
  } catch (e) {
    console.warn('Token refresh network error, retrying:', e)
    await new Promise(r => setTimeout(r, 500))
    resp = await callEdgeFn(jwt)
  }

  // 401 from the edge function means our Supabase JWT was rejected — try a
  // forced refresh and retry once before surfacing CalendarAuthError.
  if (resp.status === 401) {
    const refreshed = await getJwt(true)
    if (refreshed) {
      resp = await callEdgeFn(refreshed)
    }
  }

  // Retry once on transient server errors
  if (!resp.ok && resp.status >= 500) {
    await new Promise(r => setTimeout(r, 500))
    resp = await callEdgeFn(jwt)
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => '')
    console.error('Token refresh failed:', resp.status, body)
    throw new CalendarAuthError()
  }

  const { access_token, expires_in } = await resp.json() as {
    access_token: string
    expires_in: number
  }
  cachedToken = access_token
  cachedTokenExpiry = Date.now() + expires_in * 1000
  return access_token
}

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

// ── Main fetch ─────────────────────────────────────────────────────────────────

export async function fetchCalendarEvents(weekOffset = 0): Promise<CalendarEvent[]> {
  let token = await getProviderToken()

  const now = new Date()
  now.setHours(0, 0, 0, 0)
  // Snap to the most recent Sunday so the week is always Sun–Sat
  now.setDate(now.getDate() - now.getDay())
  const timeMin = new Date(now)
  timeMin.setDate(timeMin.getDate() + weekOffset * 7)
  // timeMax is EXCLUSIVE in Google's API, so use start of NEXT Sunday (+7 days)
  // to include all of Saturday
  const timeMax = new Date(timeMin)
  timeMax.setDate(timeMax.getDate() + 7)
  console.log('[fetchCalendarEvents] window:', timeMin.toISOString(), '→', timeMax.toISOString())

  let listResp = await fetch(
    'https://www.googleapis.com/calendar/v3/users/me/calendarList',
    { headers: { Authorization: `Bearer ${token}` } }
  )
  // If the token was stale, invalidate cache and get a fresh one
  if (listResp.status === 401) {
    cachedToken = null
    cachedTokenExpiry = 0
    token = await getProviderToken()
    listResp = await fetch(
      'https://www.googleapis.com/calendar/v3/users/me/calendarList',
      { headers: { Authorization: `Bearer ${token}` } }
    )
  }
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

// ── Gus care GCal invite sync ─────────────────────────────────────────────────

import type { GusResponsibility } from '../types'

type GusEventSpec = {
  summary: string
  startHour: number
  endHour: number
}

async function syncGusEventsBySpec(
  token: string,
  days: Set<string>,
  existing: Map<string, string>,
  spec: GusEventSpec,
): Promise<void> {
  await Promise.all([
    ...[...existing.entries()]
      .filter(([dateStr]) => !days.has(dateStr))
      .map(async ([dateStr, eventId]) => {
        const resp = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
          { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
        )
        if (!resp.ok && resp.status !== 410) {
          console.warn(`Failed to cancel ${spec.summary} for ${dateStr}:`, resp.status)
        }
      }),

    ...[...days]
      .filter(dateStr => !existing.has(dateStr))
      .map(async dateStr => {
        const resp = await fetch(
          'https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all',
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              summary: spec.summary,
              start: { dateTime: `${dateStr}T${String(spec.startHour).padStart(2, '0')}:00:00`, timeZone: 'America/New_York' },
              end:   { dateTime: `${dateStr}T${String(spec.endHour).padStart(2, '0')}:00:00`, timeZone: 'America/New_York' },
              attendees: [{ email: 'nathaniel.duncan@geaerospace.com' }],
            }),
          }
        )
        if (!resp.ok && resp.status !== 409) {
          console.warn(`Failed to create ${spec.summary} for ${dateStr}:`, resp.status)
        }
      }),
  ])
}

// ── Gus care invite sync (from computed responsibilities) ─────────────────────

async function fetchExistingGusEvents(
  token: string,
  query: string,
  timeMin: Date,
  timeMax: Date,
): Promise<Map<string, string>> {
  const resp = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
    new URLSearchParams({
      q: query,
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: 'true',
      maxResults: '250',
    }),
    { headers: { Authorization: `Bearer ${token}` } }
  )
  const map = new Map<string, string>()
  if (!resp.ok) return map
  const { items = [] } = await resp.json() as {
    items: Array<{ id: string; summary?: string; start?: { dateTime?: string; date?: string } }>
  }
  for (const item of items) {
    if (item.summary !== query) continue
    const startStr = item.start?.dateTime ?? item.start?.date ?? ''
    const dateStr = startStr.slice(0, 10)
    if (dateStr) map.set(dateStr, item.id)
  }
  return map
}

/**
 * Sync Gus pickup/dropoff Google Calendar invites based on computed responsibilities.
 * Only operates within the date range of the provided gusCare entries — events
 * outside that window are left untouched.
 */
export async function syncGusCareInvites(gusCare: GusResponsibility[]): Promise<void> {
  if (gusCare.length === 0) return

  const token = await getProviderToken()

  // Scope the sync to the input's date range
  const dates = gusCare.map(g => g.date).sort()
  const rangeStart = new Date(`${dates[0]}T00:00:00`)
  const rangeEnd = new Date(`${dates[dates.length - 1]}T23:59:59`)

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Don't modify past events
  if (rangeEnd < today) return
  const effectiveStart = rangeStart < today ? today : rangeStart

  // Build sets of days where Nat is responsible (only within range, only future)
  const pickupDays = new Set<string>()
  const dropoffDays = new Set<string>()
  for (const g of gusCare) {
    const d = new Date(`${g.date}T12:00:00`)
    if (d < today) continue
    if (g.pickup === 'nat') pickupDays.add(g.date)
    if (g.dropoff === 'nat') dropoffDays.add(g.date)
  }

  // Fetch existing events WITHIN the scoped range only
  const [existingPickups, existingDropoffs] = await Promise.all([
    fetchExistingGusEvents(token, 'Gus pickup', effectiveStart, rangeEnd),
    fetchExistingGusEvents(token, 'Gus dropoff', effectiveStart, rangeEnd),
  ])

  await Promise.all([
    syncGusEventsBySpec(token, pickupDays, existingPickups, {
      summary: 'Gus pickup',
      startHour: 17,
      endHour: 18,
    }),
    syncGusEventsBySpec(token, dropoffDays, existingDropoffs, {
      summary: 'Gus dropoff',
      startHour: 7,
      endHour: 8,
    }),
  ])
}

// ── Event editing ─────────────────────────────────────────────────────────────

export async function createOwnedEvent(
  fields: {
    summary: string
    start: string
    end: string
    allDay?: boolean
    location?: string
    owner?: 'nat' | 'caitie'
    currentUserEmail?: string
  },
): Promise<void> {
  console.log('[createOwnedEvent] entered with:', fields)
  const token = await getProviderToken()
  console.log('[createOwnedEvent] got provider token, length:', token.length)

  const body: Record<string, unknown> = { summary: fields.summary }
  if (fields.allDay) {
    // Google requires exclusive end-date for all-day events: end must be the day AFTER start
    const startDate = fields.start.slice(0, 10)
    let endDate = fields.end.slice(0, 10)
    if (endDate <= startDate) {
      const d = new Date(`${startDate}T12:00:00`)
      d.setDate(d.getDate() + 1)
      endDate = d.toISOString().slice(0, 10)
    }
    body.start = { date: startDate }
    body.end = { date: endDate }
  } else {
    body.start = { dateTime: fields.start, timeZone: 'America/New_York' }
    body.end = { dateTime: fields.end, timeZone: 'America/New_York' }
  }
  if (fields.location) body.location = fields.location

  // Tag the event with the intended owner so it shows in the right section after fetch
  if (fields.owner) {
    body.extendedProperties = { private: { homebase_owner: fields.owner } }

    // If the event is meant for the OTHER user, invite them so it lands in their calendar too
    const isCaitieEvent = fields.owner === 'caitie'
    const currentIsCaitie = fields.currentUserEmail?.toLowerCase().startsWith('caitante')
    if (isCaitieEvent && !currentIsCaitie) {
      body.attendees = [{ email: 'caitante@gmail.com' }]
    } else if (!isCaitieEvent && currentIsCaitie) {
      body.attendees = [{ email: 'ncduncan@gmail.com' }]
    }
  }

  console.log('createOwnedEvent →', JSON.stringify(body))

  const resp = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  )
  if (!resp.ok) {
    const text = await resp.text()
    console.error('createOwnedEvent failed:', resp.status, text)
    if (resp.status === 401 || resp.status === 403) {
      throw new Error(`Permission denied (${resp.status}). You may need to sign out and back in to grant calendar write access.`)
    }
    throw new Error(`Failed to create event: ${resp.status} — ${text.slice(0, 100)}`)
  }
  const created = await resp.json()
  console.log('createOwnedEvent ✓', created.id, created.htmlLink)
}

export async function patchOwnedEvent(
  eventId: string,
  calendarId: string,
  fields: { summary?: string; start?: string; end?: string },
): Promise<void> {
  const token = await getProviderToken()

  const body: Record<string, unknown> = {}
  if (fields.summary !== undefined) body.summary = fields.summary
  if (fields.start !== undefined) body.start = { dateTime: fields.start, timeZone: 'America/New_York' }
  if (fields.end !== undefined) body.end = { dateTime: fields.end, timeZone: 'America/New_York' }

  const resp = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  )
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`Failed to update event: ${resp.status} ${text}`)
  }
}
