import type { CalendarEvent, GusResponsibility } from '../types.ts'
import { parseCalendarSources, type RawCalendarSource } from './process.ts'
import {
  buildDesiredGusEvents,
  isGusSummary,
  planGusSync,
  type DesiredGusEvent,
  type ExistingGusEvent,
} from './gus-sync.ts'

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

  return (await fetchEventsInWindow(getAccessToken, timeMin, timeMax, onTokenRejected)).events
}

/**
 * Same as `fetchCalendarEvents`, but also reports how many calendar sources
 * failed to read.
 *
 * Callers that go on to WRITE based on this data (the Gus invite sync) must use
 * this variant and refuse to write when `failedSources > 0`. A silently-empty
 * source looks exactly like "Caitie has no shifts this week", which would flip
 * every Gus responsibility to her and fire real cancellations at Nat.
 */
export async function fetchCalendarEventsDetailed(
  getAccessToken: GetAccessToken,
  weekOffset = 0,
  onTokenRejected?: OnTokenRejected,
  daysAhead = 7,
): Promise<{ events: CalendarEvent[]; failedSources: number }> {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  now.setDate(now.getDate() - now.getDay())
  const timeMin = new Date(now)
  timeMin.setDate(timeMin.getDate() + weekOffset * 7 - 1)
  const timeMax = new Date(timeMin)
  timeMax.setDate(timeMax.getDate() + daysAhead + 1)
  return fetchEventsInWindow(getAccessToken, timeMin, timeMax, onTokenRejected)
}

/**
 * Fetch calendar events within an arbitrary date range. Both bounds are
 * inclusive-start / exclusive-end at midnight local time.
 *
 * Use this for broader queries (e.g. ±3 months) where week-relative anchoring
 * isn't appropriate. The week-relative `fetchCalendarEvents` retains its
 * Sunday-snap and -1 day quirk for the dashboard's Sun→Sat layout.
 */
export async function fetchCalendarEventsRange(
  getAccessToken: GetAccessToken,
  startDateISO: string,
  endDateISO: string,
  onTokenRejected?: OnTokenRejected,
): Promise<CalendarEvent[]> {
  const timeMin = new Date(`${startDateISO}T00:00:00`)
  const timeMax = new Date(`${endDateISO}T00:00:00`)
  return (await fetchEventsInWindow(getAccessToken, timeMin, timeMax, onTokenRejected)).events
}

async function fetchEventsInWindow(
  getAccessToken: GetAccessToken,
  timeMin: Date,
  timeMax: Date,
  onTokenRejected?: OnTokenRejected,
): Promise<{ events: CalendarEvent[]; failedSources: number }> {
  let token = await getAccessToken()

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

  // 401 here means our cached token expired mid-batch. Reset once per batch
  // (subsequent 401s reuse the freshly minted token) and retry the failing
  // calendar's fetch one time. Tracked via a shared boolean to coalesce the
  // refresh across parallel fan-outs.
  let tokenRefreshedThisBatch = false
  const fetchEvents = async (cal: { id: string; summary: string; summaryOverride?: string }): Promise<RawCalendarSource> => {
    // Follow nextPageToken to completion. Google documents that a single page
    // "may be less than [maxResults], or none at all, even if there are more
    // events matching the query" — so treating page 1 as the whole answer can
    // silently drop a calendar's entire contents.
    const items: Array<Record<string, unknown>> = []
    let pageToken: string | undefined
    do {
      const params = new URLSearchParams({
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        timeZone: userTimeZone,
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '250',
      })
      if (pageToken) params.set('pageToken', pageToken)
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${params}`
      let resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      if (resp.status === 401) {
        if (!tokenRefreshedThisBatch) {
          tokenRefreshedThisBatch = true
          onTokenRejected?.()
          token = await getAccessToken()
        }
        resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      }
      // Throw rather than returning an empty page: an unreadable calendar must
      // be counted as a failure, not silently rendered as "no events". Callers
      // that write based on this data key off failedSources.
      if (!resp.ok) throw new Error(`calendar ${cal.id} responded ${resp.status}`)
      const page = await resp.json() as {
        items?: Array<Record<string, unknown>>
        nextPageToken?: string
      }
      items.push(...(page.items ?? []))
      pageToken = page.nextPageToken
    } while (pageToken)
    return { cal, items }
  }

  const results = await Promise.allSettled(
    calendars
      .filter(cal => cal.selected !== false)
      .map(fetchEvents)
  )
  const sources: RawCalendarSource[] = []
  let failedSources = 0
  for (const r of results) {
    if (r.status === 'fulfilled') sources.push(r.value)
    else failedSources++
  }
  if (failedSources > 0) {
    // Count-only log: contents stay out of public-repo CI streams.
    console.warn(`[calendar] ${failedSources} calendar source(s) failed to fetch`)
  }

  return { events: parseCalendarSources(sources), failedSources }
}

// ── Gus care GCal invite sync ─────────────────────────────────────────────────
//
// The decision logic lives in ./gus-sync.ts and is shared verbatim with the
// Supabase Edge Function. Everything below is the Google Calendar executor:
// read the window, ask the planner what to do, do it.

const GCAL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
const GUS_TIME_ZONE = 'America/New_York'

/**
 * Read every Gus event on the primary calendar within the window.
 *
 * Deliberately does NOT use the `q=` free-text parameter: it's backed by a
 * search index that lags writes, so a just-created event can be invisible to
 * the next query. A plain time-range list is a direct read. Pagination is
 * followed to completion and any API failure throws — a partial read must never
 * be mistaken for "these events don't exist", which is what drove the old sync
 * to create duplicates.
 */
async function listGusEventsInWindow(
  token: string,
  timeMin: Date,
  timeMax: Date,
): Promise<ExistingGusEvent[]> {
  const found: ExistingGusEvent[] = []
  let pageToken: string | undefined
  do {
    const params = new URLSearchParams({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: 'true',
      maxResults: '250',
      // Pin the RESPONSE timezone. Without this Google renders dateTimes in the
      // calendar's own default zone, and planGusSync compares wall-clock
      // prefixes — a calendar defaulting to UTC would make every comparison
      // mismatch, rewriting (and re-emailing) every event on every pass.
      // Events are written with this same zone, so the two always line up.
      timeZone: GUS_TIME_ZONE,
    })
    if (pageToken) params.set('pageToken', pageToken)
    const resp = await fetch(`${GCAL}?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!resp.ok) {
      throw new Error(`Failed to list Gus events: ${resp.status}`)
    }
    const page = await resp.json() as {
      items?: Array<{
        id: string
        summary?: string
        status?: string
        start?: { dateTime?: string; date?: string }
        end?: { dateTime?: string; date?: string }
        attendees?: Array<{ email?: string; organizer?: boolean; self?: boolean }>
      }>
      nextPageToken?: string
    }
    for (const item of page.items ?? []) {
      if (item.status === 'cancelled') continue
      if (!isGusSummary(item.summary)) continue
      found.push({
        eventId: item.id,
        summary: item.summary as string,
        attendeeEmail: firstGuestEmail(item.attendees),
        start: item.start?.dateTime ?? item.start?.date ?? '',
        end: item.end?.dateTime ?? item.end?.date ?? '',
      })
    }
    pageToken = page.nextPageToken
  } while (pageToken)
  return found
}

/**
 * The invited guest's email. Google may add the organizer to the attendee list
 * and reorder it, so pick the first non-organizer entry rather than trusting
 * position — reading the organizer here would look like "the owner changed" and
 * churn the event on every pass.
 */
function firstGuestEmail(
  attendees: Array<{ email?: string; organizer?: boolean; self?: boolean }> | undefined,
): string | null {
  if (!attendees?.length) return null
  const guest = attendees.find(a => !a.organizer && !a.self && a.email)
  return (guest ?? attendees[0])?.email ?? null
}

function gusEventBody(want: DesiredGusEvent) {
  return {
    summary: want.summary,
    status: 'confirmed',
    start: { dateTime: want.startLocal, timeZone: GUS_TIME_ZONE },
    end: { dateTime: want.endLocal, timeZone: GUS_TIME_ZONE },
    attendees: [{ email: want.attendeeEmail }],
    extendedProperties: {
      private: {
        // Routes the event into the right dashboard column even though it
        // physically lives on Nat's primary calendar.
        homebase_owner: want.owner,
        homebase_gus_key: `${want.date}-${want.role}`,
      },
    },
  }
}

/**
 * Create-or-update the event at its deterministic id.
 *
 * PUT first, then POST on 404. That order matters: deleting an event leaves it
 * on the calendar as a `cancelled` resource that still owns the id, so a POST
 * with that id would 409 forever. PUT revives it instead. A POST that 409s means
 * a concurrent writer won the race, so we loop back to PUT once — both writers
 * are sending the same content, so they converge.
 */
async function upsertGusEvent(token: string, want: DesiredGusEvent): Promise<void> {
  const body = JSON.stringify(gusEventBody(want))
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const idUrl = `${GCAL}/${encodeURIComponent(want.eventId)}?sendUpdates=all`

  for (let attempt = 0; attempt < 2; attempt++) {
    const put = await fetch(idUrl, { method: 'PUT', headers, body })
    if (put.ok) return
    if (put.status !== 404) {
      console.warn(`Failed to update ${want.summary} for ${want.date}:`, put.status)
      return
    }
    // 404 — never existed. Insert it with our id.
    const post = await fetch(`${GCAL}?sendUpdates=all`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...gusEventBody(want), id: want.eventId }),
    })
    if (post.ok) return
    if (post.status !== 409) {
      console.warn(`Failed to create ${want.summary} for ${want.date}:`, post.status)
      return
    }
    // 409 — someone created it between our PUT and POST. Retry the PUT.
  }
  console.warn(`Gave up reconciling ${want.summary} for ${want.date} after 2 attempts`)
}

/**
 * Cancel a Gus event. `notify` controls whether the guest gets a real
 * cancellation — true for live responsibility changes, false for the one-off
 * backlog cleanup where a burst of emails would just be noise.
 */
async function deleteGusEvent(
  token: string,
  eventId: string,
  summary: string,
  dateStr: string,
  notify = true,
): Promise<void> {
  const resp = await fetch(
    `${GCAL}/${encodeURIComponent(eventId)}?sendUpdates=${notify ? 'all' : 'none'}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
  )
  // 404/410 mean it's already gone — that's the desired end state, not an error.
  if (!resp.ok && resp.status !== 404 && resp.status !== 410) {
    console.warn(`Failed to cancel ${summary} for ${dateStr}:`, resp.status)
  }
}

export type SyncGusCareInvitesOptions = {
  /** Nat's work email — used as attendee on days Nat is responsible for Gus */
  natAttendeeEmail: string
  /** Caitie's work email — used as attendee on days Caitie is responsible for Gus */
  caitieAttendeeEmail: string
}

/**
 * Sync Gus pickup/dropoff Google Calendar invites from computed responsibilities.
 *
 * Exactly one event exists per (day, role): it lives on the shared primary
 * calendar with the responsible person's work email as its only guest, and its
 * Google id is derived from (date, role, owner) — see `gusEventId`. When
 * responsibility flips, the previous owner's event is genuinely DELETEd (a real
 * cancellation reaches their Outlook) and the new owner's is upserted at its own
 * stable id.
 *
 * Only touches the date range of the supplied gusCare entries, and never the
 * past. Safe to run concurrently from anywhere — two passes compute identical
 * ids and identical content, so they converge instead of duplicating. In the
 * steady state it issues no writes at all, which is what keeps Google from
 * re-sending invitation email on every pass.
 *
 * Returns true if anything was actually changed.
 */
export async function syncGusCareInvites(
  getAccessToken: GetAccessToken,
  gusCare: GusResponsibility[],
  options: SyncGusCareInvitesOptions,
): Promise<boolean> {
  if (gusCare.length === 0) return false

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Never modify the past.
  const upcoming = gusCare.filter(g => new Date(`${g.date}T12:00:00`) >= today)
  if (upcoming.length === 0) return false

  const dates = upcoming.map(g => g.date).sort()
  const rangeStart = new Date(`${dates[0]}T00:00:00`)
  const rangeEnd = new Date(`${dates[dates.length - 1]}T23:59:59`)

  const token = await getAccessToken()

  const desired = buildDesiredGusEvents({
    gusCare: upcoming.map(g => ({ date: g.date, pickup: g.pickup, dropoff: g.dropoff })),
    natAttendeeEmail: options.natAttendeeEmail,
    caitieAttendeeEmail: options.caitieAttendeeEmail,
  })

  // Throws on a partial/failed read rather than reconciling against a half-view.
  const existing = await listGusEventsInWindow(token, rangeStart, rangeEnd)
  const ops = planGusSync(desired, existing)
  if (ops.length === 0) return false

  // Cancellations first, so a responsibility flip reads as "cancelled, then
  // invited" rather than arriving in an arbitrary order.
  for (const op of ops) {
    if (op.kind === 'delete') {
      await deleteGusEvent(token, op.eventId, op.summary, op.date)
    }
  }
  for (const op of ops) {
    if (op.kind === 'upsert') {
      await upsertGusEvent(token, op.event)
    }
  }

  return true
}

/**
 * Delete every Gus event on the primary calendar in a window, silently.
 *
 * One-off migration helper for clearing the duplicate backlog left by the old
 * non-deterministic sync. Uses sendUpdates=none so cleaning up doesn't fire a
 * burst of cancellation emails for events that are mostly in the past.
 * Returns the events it removed (or would remove, when dryRun).
 */
export async function purgeGusEvents(
  getAccessToken: GetAccessToken,
  timeMin: Date,
  timeMax: Date,
  opts: { dryRun?: boolean } = {},
): Promise<Array<{ eventId: string; summary: string; date: string }>> {
  const token = await getAccessToken()
  const existing = await listGusEventsInWindow(token, timeMin, timeMax)
  const found = existing.map(e => ({
    eventId: e.eventId,
    summary: e.summary,
    date: e.start.slice(0, 10),
  }))
  if (opts.dryRun) return found
  for (const e of found) {
    await deleteGusEvent(token, e.eventId, e.summary, e.date, false)
  }
  return found
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
