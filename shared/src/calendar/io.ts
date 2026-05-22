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
 * daysAhead: number of days from the Sunday anchor to include (default 7,
 *   i.e. Sun–Sat). The dashboard passes 8 to cover its trailing-Sunday peek.
 *
 * Pass an `onTokenRejected` callback to invalidate any external token cache
 * when a 401 is observed mid-request — the function then retries once with
 * a freshly-fetched token.
 */
export async function fetchCalendarEvents(
  getAccessToken: GetAccessToken,
  weekOffset = 0,
  onTokenRejected?: OnTokenRejected,
  daysAhead = 7,
): Promise<CalendarEvent[]> {
  let token = await getAccessToken()

  const now = new Date()
  now.setHours(0, 0, 0, 0)
  // Snap to the most recent Sunday so the week is always Sun–Sat
  now.setDate(now.getDate() - now.getDay())
  const timeMin = new Date(now)
  // Pull timeMin back one day to dodge an empirical Google Calendar API quirk:
  // when timeMin lands exactly on a UTC-calendar all-day event's start (e.g. our
  // Sunday request lining up with an AMION "Call: NC-X" all-day on that Sunday),
  // the event is silently dropped even though docs say timeMin filters on end.
  // The earlier timezone fix (passing timeZone=America/New_York) only helped
  // when timeMin was before the target day. Day-cell rendering naturally
  // discards pre-Sunday events; the extra day costs nothing.
  timeMin.setDate(timeMin.getDate() + weekOffset * 7 - 1)
  // timeMax is EXCLUSIVE in Google's API. With the default 7-day window,
  // that's the start of NEXT Sunday — covering all of Saturday. Callers that
  // also display the trailing Sunday peek pass daysAhead=8. We add the 1 day
  // back here so the total span past the visible Sunday isn't shortened.
  const timeMax = new Date(timeMin)
  timeMax.setDate(timeMax.getDate() + daysAhead + 1)

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

type GusRole = 'pickup' | 'dropoff'

type GusEventSpec = {
  summary: string
  role: GusRole
  startHour: number
  endHour: number
}

type DesiredGusEvent = { attendeeEmail: string; owner: 'nat' | 'caitie' }

type ExistingGusEvent = {
  eventId: string
  attendeeEmail: string | null
  homebaseOwner: 'nat' | 'caitie' | null
  gusKey: string | null
}

const gusKeyFor = (dateStr: string, role: GusRole) => `${dateStr}-${role}`

async function deleteGusEvent(
  token: string,
  eventId: string,
  summary: string,
  dateStr: string,
): Promise<void> {
  const resp = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
  )
  if (!resp.ok && resp.status !== 410) {
    console.warn(`Failed to cancel ${summary} for ${dateStr}:`, resp.status)
  }
}

async function createGusEvent(
  token: string,
  spec: GusEventSpec,
  dateStr: string,
  desired: DesiredGusEvent,
): Promise<void> {
  const resp = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary: spec.summary,
        start: { dateTime: `${dateStr}T${String(spec.startHour).padStart(2, '0')}:00:00`, timeZone: 'America/New_York' },
        end:   { dateTime: `${dateStr}T${String(spec.endHour).padStart(2, '0')}:00:00`, timeZone: 'America/New_York' },
        attendees: [{ email: desired.attendeeEmail }],
        extendedProperties: {
          private: {
            // homebase_owner routes the event into the correct dashboard
            // column even when the attendee email is Caitie's but the event
            // lives on Nat's primary calendar.
            homebase_owner: desired.owner,
            // homebase_gus_key is the stable per-(date, role) dedup key.
            // Two concurrent sync passes always agree on this value, so the
            // canonical event for a slot is unambiguous regardless of who's
            // currently responsible.
            homebase_gus_key: gusKeyFor(dateStr, spec.role),
          },
        },
      }),
    }
  )
  if (!resp.ok && resp.status !== 409) {
    console.warn(`Failed to create ${spec.summary} for ${dateStr}:`, resp.status)
  }
}

async function patchGusEvent(
  token: string,
  eventId: string,
  spec: GusEventSpec,
  dateStr: string,
  desired: DesiredGusEvent,
): Promise<void> {
  const resp = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attendees: [{ email: desired.attendeeEmail }],
        extendedProperties: {
          private: {
            homebase_owner: desired.owner,
            homebase_gus_key: gusKeyFor(dateStr, spec.role),
          },
        },
      }),
    }
  )
  if (!resp.ok) {
    console.warn(`Failed to patch ${spec.summary} for ${dateStr}:`, resp.status)
  }
}

async function syncGusEventsBySpec(
  token: string,
  desired: Map<string, DesiredGusEvent>,
  existing: Map<string, ExistingGusEvent[]>,
  spec: GusEventSpec,
): Promise<boolean> {
  const ops: Promise<void>[] = []

  // Cancel events for dates that are no longer desired (delete every duplicate)
  for (const [dateStr, exList] of existing) {
    if (!desired.has(dateStr)) {
      for (const ex of exList) {
        ops.push(deleteGusEvent(token, ex.eventId, spec.summary, dateStr))
      }
    }
  }

  // For each desired date, pick a canonical event by stable gusKey (or fall back
  // to the first legacy event), delete every other event on that date, and
  // either no-op or PATCH the canonical to match the desired attendee/owner.
  // PATCH (not delete+recreate) keeps the event ID stable across passes so
  // concurrent syncs converge instead of creating duplicates.
  for (const [dateStr, want] of desired) {
    const exList = existing.get(dateStr) ?? []
    const expectedKey = gusKeyFor(dateStr, spec.role)

    if (exList.length === 0) {
      ops.push(createGusEvent(token, spec, dateStr, want))
      continue
    }

    const keyedIdx = exList.findIndex(ex => ex.gusKey === expectedKey)
    const canonicalIdx = keyedIdx >= 0 ? keyedIdx : 0
    const canonical = exList[canonicalIdx]

    // Delete every other event on this date — duplicates created by races,
    // or legacy events without the stable key.
    for (let i = 0; i < exList.length; i++) {
      if (i === canonicalIdx) continue
      ops.push(deleteGusEvent(token, exList[i].eventId, spec.summary, dateStr))
    }

    const matchesAttendee = canonical.attendeeEmail?.toLowerCase() === want.attendeeEmail.toLowerCase()
    const matchesOwner = canonical.homebaseOwner === want.owner
    const matchesKey = canonical.gusKey === expectedKey
    if (!matchesAttendee || !matchesOwner || !matchesKey) {
      ops.push(patchGusEvent(token, canonical.eventId, spec, dateStr, want))
    }
  }

  await Promise.all(ops)
  return ops.length > 0
}

async function fetchExistingGusEvents(
  token: string,
  query: string,
  timeMin: Date,
  timeMax: Date,
): Promise<Map<string, ExistingGusEvent[]>> {
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
  const map = new Map<string, ExistingGusEvent[]>()
  if (!resp.ok) return map
  const { items = [] } = await resp.json() as {
    items: Array<{
      id: string
      summary?: string
      status?: string
      start?: { dateTime?: string; date?: string }
      attendees?: Array<{ email?: string }>
      extendedProperties?: { private?: Record<string, string> }
    }>
  }
  for (const item of items) {
    if (item.summary !== query) continue
    if (item.status === 'cancelled') continue
    const startStr = item.start?.dateTime ?? item.start?.date ?? ''
    const dateStr = startStr.slice(0, 10)
    if (!dateStr) continue
    const attendeeEmail = item.attendees?.[0]?.email ?? null
    const homebaseOwner = item.extendedProperties?.private?.homebase_owner as 'nat' | 'caitie' | undefined
    const gusKey = item.extendedProperties?.private?.homebase_gus_key ?? null
    const list = map.get(dateStr) ?? []
    list.push({
      eventId: item.id,
      attendeeEmail,
      homebaseOwner: homebaseOwner ?? null,
      gusKey,
    })
    map.set(dateStr, list)
  }
  return map
}

export type SyncGusCareInvitesOptions = {
  /** Nat's work email — used as attendee on days Nat is responsible for Gus */
  natAttendeeEmail: string
  /** Caitie's work email — used as attendee on days Caitie is responsible for Gus */
  caitieAttendeeEmail: string
}

/**
 * Sync Gus pickup/dropoff Google Calendar invites based on computed responsibilities.
 * Creates one event per (day, role) for whichever owner is responsible, with that
 * owner's work email as attendee. When responsibility flips, the existing event is
 * PATCHed in place (attendee + homebase_owner) so each person sees the invite only
 * on their responsible days while keeping the event ID stable.
 *
 * Only operates within the date range of the provided gusCare entries — events
 * outside that window are left untouched. Idempotent: matches existing events by
 * a stable extendedProperties.private.homebase_gus_key (`<date>-<role>`) and falls
 * back to summary+date for legacy events created before the key was introduced.
 * Safe to run from multiple sources (web + agent) and concurrently — concurrent
 * passes converge on the same canonical event via PATCH instead of creating
 * duplicates.
 */
export async function syncGusCareInvites(
  getAccessToken: GetAccessToken,
  gusCare: GusResponsibility[],
  options: SyncGusCareInvitesOptions,
): Promise<boolean> {
  if (gusCare.length === 0) return false

  const token = await getAccessToken()

  // Scope the sync to the input's date range
  const dates = gusCare.map(g => g.date).sort()
  const rangeStart = new Date(`${dates[0]}T00:00:00`)
  const rangeEnd = new Date(`${dates[dates.length - 1]}T23:59:59`)

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Don't modify past events
  if (rangeEnd < today) return false
  const effectiveStart = rangeStart < today ? today : rangeStart

  const attendeeFor = (owner: 'nat' | 'caitie') =>
    owner === 'nat' ? options.natAttendeeEmail : options.caitieAttendeeEmail

  // Build desired-state maps: one entry per future day per role, keyed by date.
  const pickupDesired = new Map<string, DesiredGusEvent>()
  const dropoffDesired = new Map<string, DesiredGusEvent>()
  for (const g of gusCare) {
    const d = new Date(`${g.date}T12:00:00`)
    if (d < today) continue
    pickupDesired.set(g.date, { attendeeEmail: attendeeFor(g.pickup), owner: g.pickup })
    dropoffDesired.set(g.date, { attendeeEmail: attendeeFor(g.dropoff), owner: g.dropoff })
  }

  const [existingPickups, existingDropoffs] = await Promise.all([
    fetchExistingGusEvents(token, 'Gus pickup', effectiveStart, rangeEnd),
    fetchExistingGusEvents(token, 'Gus dropoff', effectiveStart, rangeEnd),
  ])

  const [pickupChanged, dropoffChanged] = await Promise.all([
    syncGusEventsBySpec(token, pickupDesired, existingPickups, {
      summary: 'Gus pickup',
      role: 'pickup',
      startHour: 17,
      endHour: 18,
    }),
    syncGusEventsBySpec(token, dropoffDesired, existingDropoffs, {
      summary: 'Gus dropoff',
      role: 'dropoff',
      startHour: 7,
      endHour: 8,
    }),
  ])

  return pickupChanged || dropoffChanged
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
