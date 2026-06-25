import { supabase } from './supabase'
import { OWNER_EMAILS, NAT_WORK_EMAIL, CAITIE_WORK_EMAIL } from './owners'
import { parseCalendarSources } from '@home-base/shared/calendar/process'
import type { GusResponsibility, CalendarEvent } from '@home-base/shared/types'

export { eventOwner, processAmionEvents, parseCalendarSources } from '@home-base/shared/calendar/process'

// All Google Calendar reads/writes go through the calendar-ops Edge Function,
// which uses a single shared server-side credential. The browser never holds a
// Google access_token, so there are no provider-token expiries, refresh
// failures, or re-auth flows on the calendar path.

type CalendarOpsBody = Record<string, unknown> & { op: string }

async function callOp<T = unknown>(body: CalendarOpsBody): Promise<T> {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/calendar-ops`

  const send = async (jwt: string) =>
    fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

  const getJwt = async (force = false) => {
    if (force) {
      const { data } = await supabase.auth.refreshSession()
      return data.session?.access_token ?? null
    }
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token ?? null
  }

  let jwt = await getJwt()
  if (!jwt) throw new Error('Not signed in')
  let resp = await send(jwt)

  // 401 = Supabase JWT was rejected. Force-refresh and retry once before giving up.
  if (resp.status === 401) {
    const refreshed = await getJwt(true)
    if (refreshed) {
      jwt = refreshed
      resp = await send(jwt)
    }
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    let detail = text
    try {
      const j = JSON.parse(text) as { error?: string }
      if (j.error) detail = j.error
    } catch { /* not JSON */ }
    throw new Error(`calendar-ops ${body.op} failed: ${resp.status} ${detail.slice(0, 200)}`)
  }
  return resp.json() as Promise<T>
}

// ── Public API ────────────────────────────────────────────────────────────────

type RawCalendarSource = Parameters<typeof parseCalendarSources>[0][number]

// Dashboard renders an 8-day grid (Sun + next-Sun peek per WeekDashboard).
// Snap timeMin to the most recent Sunday, then pull back 1 day to dodge an
// empirical Google Calendar API quirk (UTC-calendar all-day events disappearing
// when timeMin equals their start). timeMax is exclusive in Google's API, so we
// add an extra trailing day to keep Saturday + the trailing-Sunday peek intact.
export async function fetchCalendarEvents(weekOffset = 0): Promise<CalendarEvent[]> {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  now.setDate(now.getDate() - now.getDay()) // snap to Sunday
  const timeMin = new Date(now)
  timeMin.setDate(timeMin.getDate() + weekOffset * 7 - 1)
  const timeMax = new Date(timeMin)
  timeMax.setDate(timeMax.getDate() + 8 + 1) // 8 day window + 1 for exclusive timeMax

  const { sources } = await callOp<{ sources: RawCalendarSource[] }>({
    op: 'listCalendarEvents',
    timeMinISO: timeMin.toISOString(),
    timeMaxISO: timeMax.toISOString(),
  })
  return parseCalendarSources(sources)
}

export async function fetchCalendarEventsRange(startISO: string, endISO: string): Promise<CalendarEvent[]> {
  const timeMin = new Date(`${startISO}T00:00:00`)
  const timeMax = new Date(`${endISO}T00:00:00`)
  const { sources } = await callOp<{ sources: RawCalendarSource[] }>({
    op: 'listCalendarEvents',
    timeMinISO: timeMin.toISOString(),
    timeMaxISO: timeMax.toISOString(),
  })
  return parseCalendarSources(sources)
}

export async function syncGusCareInvites(gusCare: GusResponsibility[]): Promise<boolean> {
  const { changed } = await callOp<{ changed: boolean }>({
    op: 'syncGusInvites',
    gusCare,
    natAttendeeEmail: NAT_WORK_EMAIL,
    caitieAttendeeEmail: CAITIE_WORK_EMAIL,
  })
  return changed
}

export type CreateOwnedEventFields = {
  summary: string
  start: string
  end: string
  allDay?: boolean
  location?: string
  owner?: 'nat' | 'caitie'
  currentUserEmail?: string
}

export async function createOwnedEvent(fields: CreateOwnedEventFields): Promise<void> {
  await callOp({
    op: 'createEvent',
    fields,
    caitieEmail: OWNER_EMAILS.caitie,
    natEmail: OWNER_EMAILS.nat,
  })
}

export async function patchOwnedEvent(
  eventId: string,
  calendarId: string,
  fields: { summary?: string; start?: string; end?: string },
): Promise<void> {
  await callOp({
    op: 'patchEvent',
    eventId,
    calendarId,
    fields,
  })
}
