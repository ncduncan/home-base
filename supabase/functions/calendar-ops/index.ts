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
//   listCalendarEvents  → {timeMinISO, timeMaxISO} → {sources}
//   syncGusInvites      → {gusCare, natAttendeeEmail, caitieAttendeeEmail} → {changed}
//   createEvent         → {fields, caitieEmail, natEmail, caitieEmailPrefix?} → {ok}
//   patchEvent          → {eventId, calendarId, fields} → {ok}
//
// listCalendarEvents takes the explicit time window (callers compute it from
// either a week offset or an arbitrary range). Returns RawCalendarSource[];
// caller runs parseCalendarSources to produce CalendarEvent[].

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

async function listCalendarEvents(timeMinISO: string, timeMaxISO: string): Promise<{ sources: RawCalendarSource[] }> {
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
    const params = new URLSearchParams({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      timeZone: userTimeZone,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
    })
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
    if (!resp.ok) return { cal, items: [] as Array<Record<string, unknown>> }
    const { items = [] } = await resp.json() as { items: Array<Record<string, unknown>> }
    return { cal, items }
  }

  const results = await Promise.allSettled(
    calendars.filter(cal => cal.selected !== false).map(fetchEvents)
  )
  const sources: RawCalendarSource[] = []
  let rejectedCount = 0
  for (const r of results) {
    if (r.status === 'fulfilled') sources.push(r.value)
    else rejectedCount++
  }
  if (rejectedCount > 0) {
    console.warn(`[calendar-ops] ${rejectedCount} calendar source(s) failed`)
  }
  return { sources }
}

// ── Op: syncGusInvites (port of shared/calendar/io.ts syncGusCareInvites) ─────

type GusRole = 'pickup' | 'dropoff'
type GusResponsibility = { date: string; pickup: 'nat' | 'caitie'; dropoff: 'nat' | 'caitie' }
type DesiredGusEvent = { attendeeEmail: string; owner: 'nat' | 'caitie' }
type ExistingGusEvent = {
  eventId: string
  attendeeEmail: string | null
  homebaseOwner: 'nat' | 'caitie' | null
  gusKey: string | null
}
type GusEventSpec = { summary: string; role: GusRole; startHour: number; endHour: number }

const gusKeyFor = (dateStr: string, role: GusRole) => `${dateStr}-${role}`

async function deleteGusEvent(token: string, eventId: string, summary: string, dateStr: string): Promise<void> {
  const resp = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
  )
  if (!resp.ok && resp.status !== 410) {
    console.warn(`Failed to cancel ${summary} for ${dateStr}:`, resp.status)
  }
}

async function createGusEvent(token: string, spec: GusEventSpec, dateStr: string, desired: DesiredGusEvent): Promise<void> {
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
            homebase_owner: desired.owner,
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

async function patchGusEvent(token: string, eventId: string, spec: GusEventSpec, dateStr: string, desired: DesiredGusEvent): Promise<void> {
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

async function fetchExistingGusEvents(token: string, query: string, timeMin: Date, timeMax: Date): Promise<Map<string, ExistingGusEvent[]>> {
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
    list.push({ eventId: item.id, attendeeEmail, homebaseOwner: homebaseOwner ?? null, gusKey })
    map.set(dateStr, list)
  }
  return map
}

async function syncGusEventsBySpec(token: string, desired: Map<string, DesiredGusEvent>, existing: Map<string, ExistingGusEvent[]>, spec: GusEventSpec): Promise<boolean> {
  const ops: Promise<void>[] = []
  for (const [dateStr, exList] of existing) {
    if (!desired.has(dateStr)) {
      for (const ex of exList) ops.push(deleteGusEvent(token, ex.eventId, spec.summary, dateStr))
    }
  }
  for (const [dateStr, want] of desired) {
    const exList = existing.get(dateStr) ?? []
    const expectedKey = gusKeyFor(dateStr, spec.role)
    if (exList.length === 0) { ops.push(createGusEvent(token, spec, dateStr, want)); continue }
    const keyedIdx = exList.findIndex(ex => ex.gusKey === expectedKey)
    const canonicalIdx = keyedIdx >= 0 ? keyedIdx : 0
    const canonical = exList[canonicalIdx]
    for (let i = 0; i < exList.length; i++) {
      if (i === canonicalIdx) continue
      ops.push(deleteGusEvent(token, exList[i].eventId, spec.summary, dateStr))
    }
    const matchesAttendee = canonical.attendeeEmail?.toLowerCase() === want.attendeeEmail.toLowerCase()
    const matchesOwner = canonical.homebaseOwner === want.owner
    const matchesKey = canonical.gusKey === expectedKey
    if (!matchesAttendee || !matchesOwner) {
      // Owner changed. PATCHing the attendee list doesn't reliably cancel the
      // removed attendee's copy cross-system (Google → GE/Outlook), so DELETE
      // the canonical (sendUpdates=all → real cancellation to the old attendee)
      // and CREATE fresh for the new owner. Keep in sync with the shared copy
      // in shared/src/calendar/io.ts.
      ops.push(deleteGusEvent(token, canonical.eventId, spec.summary, dateStr))
      ops.push(createGusEvent(token, spec, dateStr, want))
    } else if (!matchesKey) {
      // Same owner — legacy event missing the stable key; stamp it, no churn.
      ops.push(patchGusEvent(token, canonical.eventId, spec, dateStr, want))
    }
  }
  await Promise.all(ops)
  return ops.length > 0
}

async function syncGusInvites(
  gusCare: GusResponsibility[],
  natAttendeeEmail: string,
  caitieAttendeeEmail: string,
): Promise<{ changed: boolean }> {
  if (gusCare.length === 0) return { changed: false }
  const token = await getGoogleAccessToken()

  const dates = gusCare.map(g => g.date).sort()
  const rangeStart = new Date(`${dates[0]}T00:00:00`)
  const rangeEnd = new Date(`${dates[dates.length - 1]}T23:59:59`)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  if (rangeEnd < today) return { changed: false }
  const effectiveStart = rangeStart < today ? today : rangeStart

  const attendeeFor = (owner: 'nat' | 'caitie') =>
    owner === 'nat' ? natAttendeeEmail : caitieAttendeeEmail
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
    syncGusEventsBySpec(token, pickupDesired, existingPickups, { summary: 'Gus pickup', role: 'pickup', startHour: 17, endHour: 18 }),
    syncGusEventsBySpec(token, dropoffDesired, existingDropoffs, { summary: 'Gus dropoff', role: 'dropoff', startHour: 7, endHour: 8 }),
  ])
  return { changed: pickupChanged || dropoffChanged }
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
