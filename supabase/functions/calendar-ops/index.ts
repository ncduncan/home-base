// Calendar operations proxy.
//
// Routes ALL Google Calendar reads/writes for the web app through a single
// shared server-side credential (Supabase secret GOOGLE_OAUTH_TOKEN, same
// JSON-shape as the Sunday briefing agent's GitHub secret of the same name).
// The browser never receives a Google access_token.
//
// Auth: caller passes a Supabase JWT in `Authorization: Bearer ...`. JWT must
// belong to a user whose email is in ALLOWED_EMAILS.
//
// Ops (request body `{op: "...", ...}`):
//   listCalendarEvents  → {timeMinISO, timeMaxISO} → {sources, failedSources}
//   syncGusInvites      → {gusCare, natAttendeeEmail, caitieAttendeeEmail} → {changed}
//   createEvent         → {fields, caitieEmail, natEmail, caitieEmailPrefix?} → {ok}
//   patchEvent          → {eventId, calendarId, fields} → {ok}
//
// listCalendarEvents takes the explicit time window (callers compute it from
// either a week offset or an arbitrary range). Returns RawCalendarSource[];
// caller runs parseCalendarSources to produce CalendarEvent[].

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// Generated mirror of shared/src/calendar/gus-sync.ts — the same reconciliation
// planner the Sunday briefing agent runs. Do not edit it here; edit the shared
// source and run `npm run sync:edge-shared` (a vitest check enforces this).
import {
  buildDesiredGusEvents,
  isGusSummary,
  planGusSync,
  type DesiredGusEvent,
  type ExistingGusEvent,
  type GusOwner,
} from './gus-sync.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const GOOGLE_OAUTH_TOKEN = Deno.env.get('GOOGLE_OAUTH_TOKEN')!
const ALLOWED_EMAILS = (Deno.env.get('ALLOWED_EMAILS') ?? '')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean)

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// Origin allowlist for CORS. Defaults to the GitHub Pages deploy + local dev;
// override via the ALLOWED_ORIGINS secret (comma-separated) if the site moves.
// We echo the caller's Origin only when it's on the list rather than '*', so a
// random site can't drive this function even if it somehow obtained a JWT.
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ??
  'https://ncduncan.github.io,http://localhost:5173')
  .split(',').map(o => o.trim()).filter(Boolean)

function corsHeaders(origin: string | null): Record<string, string> {
  const allowOrigin = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

// Calendars this function is permitted to mutate through the shared credential.
// patchEvent takes a caller-supplied calendarId; without this gate an allowed
// user could patch any event on any calendar the shared account can reach.
const WRITABLE_CALENDAR_IDS = new Set(['primary'])

// ── Google token refresh (shared credential, module-scoped cache) ─────────────

type TokenJson = {
  refresh_token: string
  client_id: string
  client_secret: string
  token_uri?: string
}

const parsedToken: TokenJson = (() => {
  const t = JSON.parse(GOOGLE_OAUTH_TOKEN) as TokenJson
  if (!t.refresh_token || !t.client_id || !t.client_secret) {
    throw new Error('GOOGLE_OAUTH_TOKEN missing required fields')
  }
  return t
})()

let cachedAccessToken: { token: string; expiresAt: number } | null = null

async function getGoogleAccessToken(): Promise<string> {
  if (cachedAccessToken && Date.now() < cachedAccessToken.expiresAt - 5 * 60_000) {
    return cachedAccessToken.token
  }
  const resp = await fetch(parsedToken.token_uri ?? 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: parsedToken.client_id,
      client_secret: parsedToken.client_secret,
      refresh_token: parsedToken.refresh_token,
    }),
  })
  if (!resp.ok) {
    const body = await resp.text()
    throw new Error(`Google token refresh failed: ${resp.status} ${body.slice(0, 200)}`)
  }
  const json = await resp.json() as { access_token: string; expires_in: number }
  cachedAccessToken = {
    token: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  }
  return json.access_token
}

// ── Op: listCalendarEvents (port of shared/calendar/io.ts fetchCalendarEvents) ─

type RawCalendarSource = {
  cal: { id: string; summary: string; summaryOverride?: string; selected?: boolean }
  items: Array<Record<string, unknown>>
}

async function listCalendarEvents(
  timeMinISO: string,
  timeMaxISO: string,
): Promise<{ sources: RawCalendarSource[]; failedSources: number }> {
  let token = await getGoogleAccessToken()

  const timeMin = new Date(timeMinISO)
  const timeMax = new Date(timeMaxISO)
  if (isNaN(timeMin.getTime()) || isNaN(timeMax.getTime())) {
    throw new Error('listCalendarEvents requires valid timeMinISO and timeMaxISO')
  }

  let listResp = await fetch(
    'https://www.googleapis.com/calendar/v3/users/me/calendarList',
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (listResp.status === 401) {
    cachedAccessToken = null
    token = await getGoogleAccessToken()
    listResp = await fetch(
      'https://www.googleapis.com/calendar/v3/users/me/calendarList',
      { headers: { Authorization: `Bearer ${token}` } }
    )
  }
  if (!listResp.ok) throw new Error('Failed to fetch calendar list')
  const { items: calendars = [] } = await listResp.json() as {
    items: Array<{ id: string; summary: string; summaryOverride?: string; selected?: boolean }>
  }

  // Pin timezone to America/New_York (server has no user locale). Web client
  // ran Intl.DateTimeFormat() on the browser — here we hard-code Nat's TZ since
  // that's the household's location and the calendar's AMION feed is UTC.
  const userTimeZone = 'America/New_York'

  let tokenRefreshedThisBatch = false
  const fetchEvents = async (cal: { id: string; summary: string; summaryOverride?: string }): Promise<RawCalendarSource> => {
    // Follow nextPageToken to completion. Google documents that a single page
    // "may be less than [maxResults], or none at all, even if there are more
    // events matching the query", so page 1 is not the whole answer.
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
          cachedAccessToken = null
          token = await getGoogleAccessToken()
        }
        resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      }
      // Throw rather than yielding an empty page: an unreadable calendar has to
      // count as a failure. Silently returning [] looks exactly like "Caitie has
      // no shifts", which would flip every Gus slot to her.
      if (!resp.ok) throw new Error(`calendar responded ${resp.status}`)
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
    calendars.filter(cal => cal.selected !== false).map(fetchEvents)
  )
  const sources: RawCalendarSource[] = []
  let failedSources = 0
  for (const r of results) {
    if (r.status === 'fulfilled') sources.push(r.value)
    else failedSources++
  }
  if (failedSources > 0) {
    console.warn(`[calendar-ops] ${failedSources} calendar source(s) failed`)
  }
  // failedSources is returned so the caller can refuse to WRITE from a partial
  // read (see the Gus sync guard in DashboardPage).
  return { sources, failedSources }
}

// ── Op: syncGusInvites ───────────────────────────────────────────────────────
//
// The decision logic is imported from ./gus-sync.ts — a generated mirror of
// shared/src/calendar/gus-sync.ts, which the Sunday briefing agent also uses.
// Never edit the mirror directly; edit the shared source and run
// `npm run sync:edge-shared`. Everything below is just the Google executor.

const GCAL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
const GUS_TIME_ZONE = 'America/New_York'

type GusResponsibility = { date: string; pickup: GusOwner; dropoff: GusOwner }

/**
 * Read every Gus event on the primary calendar in the window.
 *
 * No `q=` free-text parameter — that index lags writes, so a just-created event
 * can be invisible to the next query, which is what let the old sync conclude
 * "nothing exists" and create yet another duplicate. Pagination is followed to
 * completion and any failure throws; a partial read must never be mistaken for
 * an empty calendar.
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
    if (!resp.ok) throw new Error(`Failed to list Gus events: ${resp.status}`)
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
        homebase_owner: want.owner,
        homebase_gus_key: `${want.date}-${want.role}`,
      },
    },
  }
}

/**
 * Create-or-update the event at its deterministic id.
 *
 * PUT first, POST on 404. That order matters: a deleted event lingers as a
 * `cancelled` resource that still owns its id, so POSTing that id would 409
 * forever — PUT revives it. A POST that 409s means a concurrent writer won the
 * race, so loop back to PUT once; both writers send identical content and
 * converge.
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
  }
  console.warn(`Gave up reconciling ${want.summary} for ${want.date} after 2 attempts`)
}

async function deleteGusEvent(
  token: string,
  eventId: string,
  summary: string,
  dateStr: string,
): Promise<void> {
  const resp = await fetch(
    `${GCAL}/${encodeURIComponent(eventId)}?sendUpdates=all`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
  )
  // 404/410 mean it's already gone — the desired end state, not an error.
  if (!resp.ok && resp.status !== 404 && resp.status !== 410) {
    console.warn(`Failed to cancel ${summary} for ${dateStr}:`, resp.status)
  }
}

/**
 * Reconcile Gus invites. One event per (day, role), living on the shared
 * primary calendar with the responsible person's work email as its only guest
 * and a Google id derived from (date, role, owner). Safe to run concurrently
 * with the Sunday agent or another browser tab: identical ids and identical
 * content mean passes converge rather than duplicate. Issues no writes at all
 * once converged, which is what stops repeat invitation email.
 */
async function syncGusInvites(
  gusCare: GusResponsibility[],
  natAttendeeEmail: string,
  caitieAttendeeEmail: string,
): Promise<{ changed: boolean }> {
  if (gusCare.length === 0) return { changed: false }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Never modify the past.
  const upcoming = gusCare.filter(g => new Date(`${g.date}T12:00:00`) >= today)
  if (upcoming.length === 0) return { changed: false }

  const dates = upcoming.map(g => g.date).sort()
  const rangeStart = new Date(`${dates[0]}T00:00:00`)
  const rangeEnd = new Date(`${dates[dates.length - 1]}T23:59:59`)

  const token = await getGoogleAccessToken()

  const desired = buildDesiredGusEvents({
    gusCare: upcoming.map(g => ({ date: g.date, pickup: g.pickup, dropoff: g.dropoff })),
    natAttendeeEmail,
    caitieAttendeeEmail,
  })

  // Throws on a partial/failed read rather than reconciling against a half-view.
  const existing = await listGusEventsInWindow(token, rangeStart, rangeEnd)
  const ops = planGusSync(desired, existing)
  if (ops.length === 0) return { changed: false }

  // Cancellations first, so a flip reads as "cancelled, then invited".
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

  return { changed: true }
}

// ── Op: createEvent (port of shared/calendar/io.ts createOwnedEvent) ──────────

type CreateEventFields = {
  summary: string
  start: string
  end: string
  allDay?: boolean
  location?: string
  owner?: 'nat' | 'caitie'
  currentUserEmail?: string
}

async function createEvent(
  fields: CreateEventFields,
  caitieEmail: string,
  natEmail: string,
  caitieEmailPrefix = 'caitante',
): Promise<{ ok: true }> {
  const token = await getGoogleAccessToken()

  const body: Record<string, unknown> = { summary: fields.summary }
  if (fields.allDay) {
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

  if (fields.owner) {
    body.extendedProperties = { private: { homebase_owner: fields.owner } }
    const isCaitieEvent = fields.owner === 'caitie'
    const currentIsCaitie = fields.currentUserEmail?.toLowerCase().startsWith(caitieEmailPrefix)
    if (isCaitieEvent && !currentIsCaitie) {
      body.attendees = [{ email: caitieEmail }]
    } else if (!isCaitieEvent && currentIsCaitie) {
      body.attendees = [{ email: natEmail }]
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
    throw new Error(`Failed to create event: ${resp.status} — ${text.slice(0, 200)}`)
  }
  return { ok: true }
}

// ── Op: patchEvent (port of shared/calendar/io.ts patchOwnedEvent) ────────────

async function patchEvent(
  eventId: string,
  calendarId: string,
  fields: { summary?: string; start?: string; end?: string },
): Promise<{ ok: true }> {
  if (!WRITABLE_CALENDAR_IDS.has(calendarId)) {
    throw new Error(`patchEvent: calendarId "${calendarId}" is not writable`)
  }
  const token = await getGoogleAccessToken()

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
    throw new Error(`Failed to update event: ${resp.status} ${text.slice(0, 200)}`)
  }
  return { ok: true }
}

// ── HTTP entry point ──────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get('Origin'))
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: cors })
  }
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: cors })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return Response.json({ error: 'Missing authorization header' }, { status: 401, headers: cors })
  }
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(
    authHeader.replace('Bearer ', '')
  )
  if (authError || !user) {
    return Response.json({ error: 'Invalid token' }, { status: 401, headers: cors })
  }
  const callerEmail = (user.email ?? '').toLowerCase()
  // Fail closed: an empty/unset ALLOWED_EMAILS must deny everyone, not skip the
  // check. Otherwise a misconfigured secret opens the shared Google credential
  // to any user who can mint a valid Supabase JWT.
  if (ALLOWED_EMAILS.length === 0 || !ALLOWED_EMAILS.includes(callerEmail)) {
    return Response.json({ error: 'Not authorized' }, { status: 403, headers: cors })
  }

  let body: { op?: string } & Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400, headers: cors })
  }

  try {
    let result: unknown
    switch (body.op) {
      case 'listCalendarEvents': {
        const timeMinISO = String(body.timeMinISO ?? '')
        const timeMaxISO = String(body.timeMaxISO ?? '')
        if (!timeMinISO || !timeMaxISO) {
          throw new Error('listCalendarEvents requires timeMinISO and timeMaxISO')
        }
        result = await listCalendarEvents(timeMinISO, timeMaxISO)
        break
      }
      case 'syncGusInvites': {
        const gusCare = body.gusCare as GusResponsibility[]
        const natAttendeeEmail = String(body.natAttendeeEmail ?? '')
        const caitieAttendeeEmail = String(body.caitieAttendeeEmail ?? '')
        if (!Array.isArray(gusCare) || !natAttendeeEmail || !caitieAttendeeEmail) {
          throw new Error('syncGusInvites requires gusCare[], natAttendeeEmail, caitieAttendeeEmail')
        }
        result = await syncGusInvites(gusCare, natAttendeeEmail, caitieAttendeeEmail)
        break
      }
      case 'createEvent': {
        const fields = body.fields as CreateEventFields
        const caitieEmail = String(body.caitieEmail ?? '')
        const natEmail = String(body.natEmail ?? '')
        const caitieEmailPrefix = body.caitieEmailPrefix ? String(body.caitieEmailPrefix) : undefined
        if (!fields || !caitieEmail || !natEmail) {
          throw new Error('createEvent requires fields, caitieEmail, natEmail')
        }
        result = await createEvent(fields, caitieEmail, natEmail, caitieEmailPrefix)
        break
      }
      case 'patchEvent': {
        const eventId = String(body.eventId ?? '')
        const calendarId = String(body.calendarId ?? '')
        const fields = body.fields as { summary?: string; start?: string; end?: string }
        if (!eventId || !calendarId || !fields) {
          throw new Error('patchEvent requires eventId, calendarId, fields')
        }
        result = await patchEvent(eventId, calendarId, fields)
        break
      }
      default:
        return Response.json({ error: `Unknown op: ${body.op}` }, { status: 400, headers: cors })
    }
    return Response.json(result, { headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[calendar-ops] op=${body.op} failed:`, message)
    return Response.json({ error: message }, { status: 500, headers: cors })
  }
})
