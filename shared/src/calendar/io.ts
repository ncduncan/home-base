import type { CalendarEvent, GusResponsibility } from '../types.ts'
import { parseCalendarSources, type RawCalendarSource } from './process.ts'

export type GetAccessToken = () => Promise<string>

/** Optional hook fired when a 401 is observed so callers can invalidate caches. */
export type OnTokenRejected = () => void

/**
 * Fetch the upcoming-week calendar events across all selected calendars.
 * Returns parsed CalendarEvents with AMION shifts already processed.
 *
 * weekOffset: 0 = this week (most recent Sunday → +7d), 1 = next, -1 = last.
 *
 * Pass an `onTokenRejected` callback to invalidate any external token cache
 * when a 401 is observed mid-request — the function then retries once with
 * a freshly-fetched token.
 */
export async function fetchCalendarEvents(
  getAccessToken: GetAccessToken,
  weekOffset = 0,
  onTokenRejected?: OnTokenRejected,
): Promise<CalendarEvent[]> {
  let token = await getAccessToken()

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

  let listResp = await fetch(
    'https://www.googleapis.com/calendar/v3/users/me/calendarList',
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (listResp.status === 401) {
    onTokenRejected?.()
    token = await getAccessToken()
    listResp = await fetch(
      'https://www.googleapis.com/calendar/v3/users/me/calendarList',
      { headers: { Authorization: `Bearer ${token}` } }
    )
  }
  if (!listResp.ok) throw new Error('Failed to fetch calendar list')
  const { items: calendars = [] } = await listResp.json() as {
    items: Array<{ id: string; summary: string; summaryOverride?: string; selected?: boolean }>
  }

  // The AMION subscription calendar has timeZone=UTC. Without an explicit
  // timeZone parameter, Google interprets all-day events using the calendar's
  // own timezone — so a Sunday request whose timeMin is "Sun 00:00 EDT" (=
  // Mon 04:00 UTC) lands AFTER the UTC start of the all-day Sunday event and
  // Google silently drops the whole Sunday from the response. Passing an
  // explicit timezone forces local interpretation, which keeps Sundays in.
  // Bug history: tracked down via direct Google API + MCP cross-checks on 2026-04-08.
  const userTimeZone = typeof Intl !== 'undefined'
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : 'America/New_York'
  const sources: RawCalendarSource[] = await Promise.all(
    calendars
      .filter(cal => cal.selected !== false)
      .map(async cal => {
        const params = new URLSearchParams({
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          timeZone: userTimeZone,
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

  return parseCalendarSources(sources)
}

// ── Gus care GCal invite sync ─────────────────────────────────────────────────

type GusEventSpec = {
  summary: string
  startHour: number
  endHour: number
  attendeeEmail: string
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
              attendees: [{ email: spec.attendeeEmail }],
            }),
          }
        )
        if (!resp.ok && resp.status !== 409) {
          console.warn(`Failed to create ${spec.summary} for ${dateStr}:`, resp.status)
        }
      }),
  ])
}

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

export type SyncGusCareInvitesOptions = {
  /** Email to invite to Gus events (Nat's work email, by default) */
  attendeeEmail: string
}

/**
 * Sync Gus pickup/dropoff Google Calendar invites based on computed responsibilities.
 * Only operates within the date range of the provided gusCare entries — events
 * outside that window are left untouched. Idempotent: matches existing events by
 * summary + date so it's safe to run from multiple sources (web + agent).
 */
export async function syncGusCareInvites(
  getAccessToken: GetAccessToken,
  gusCare: GusResponsibility[],
  options: SyncGusCareInvitesOptions,
): Promise<void> {
  if (gusCare.length === 0) return

  const token = await getAccessToken()

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

  const [existingPickups, existingDropoffs] = await Promise.all([
    fetchExistingGusEvents(token, 'Gus pickup', effectiveStart, rangeEnd),
    fetchExistingGusEvents(token, 'Gus dropoff', effectiveStart, rangeEnd),
  ])

  await Promise.all([
    syncGusEventsBySpec(token, pickupDays, existingPickups, {
      summary: 'Gus pickup',
      startHour: 17,
      endHour: 18,
      attendeeEmail: options.attendeeEmail,
    }),
    syncGusEventsBySpec(token, dropoffDays, existingDropoffs, {
      summary: 'Gus dropoff',
      startHour: 7,
      endHour: 8,
      attendeeEmail: options.attendeeEmail,
    }),
  ])
}

// ── Event editing ─────────────────────────────────────────────────────────────

export type CreateOwnedEventFields = {
  summary: string
  start: string
  end: string
  allDay?: boolean
  location?: string
  owner?: 'nat' | 'caitie'
  currentUserEmail?: string
}

export type CreateOwnedEventConfig = {
  /** Email used when the event owner is Caitie and the current user isn't */
  caitieEmail: string
  /** Email used when the event owner is Nat and the current user is Caitie */
  natEmail: string
  /** Lowercase prefix for detecting "current user is Caitie" — defaults to 'caitante' */
  caitieEmailPrefix?: string
}

export async function createOwnedEvent(
  getAccessToken: GetAccessToken,
  fields: CreateOwnedEventFields,
  config: CreateOwnedEventConfig,
): Promise<void> {
  const token = await getAccessToken()

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
    const prefix = config.caitieEmailPrefix ?? 'caitante'
    const currentIsCaitie = fields.currentUserEmail?.toLowerCase().startsWith(prefix)
    if (isCaitieEvent && !currentIsCaitie) {
      body.attendees = [{ email: config.caitieEmail }]
    } else if (!isCaitieEvent && currentIsCaitie) {
      body.attendees = [{ email: config.natEmail }]
    }
  }

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
    if (resp.status === 401 || resp.status === 403) {
      throw new Error(`Permission denied (${resp.status}). You may need to sign out and back in to grant calendar write access.`)
    }
    throw new Error(`Failed to create event: ${resp.status} — ${text.slice(0, 100)}`)
  }
}

export async function patchOwnedEvent(
  getAccessToken: GetAccessToken,
  eventId: string,
  calendarId: string,
  fields: { summary?: string; start?: string; end?: string },
): Promise<void> {
  const token = await getAccessToken()

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
