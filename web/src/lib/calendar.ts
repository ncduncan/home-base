import { supabase } from './supabase'
import {
  fetchCalendarEvents as sharedFetchCalendarEvents,
  syncGusCareInvites as sharedSyncGusCareInvites,
  createOwnedEvent as sharedCreateOwnedEvent,
  patchOwnedEvent as sharedPatchOwnedEvent,
  type CreateOwnedEventFields,
} from '@home-base/shared/calendar/io'
import type { GusResponsibility } from '@home-base/shared/types'

export { eventOwner, processAmionEvents, parseCalendarSources } from '@home-base/shared/calendar/process'

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

// ── Public API ────────────────────────────────────────────────────────────────

export function fetchCalendarEvents(weekOffset = 0) {
  return sharedFetchCalendarEvents(getProviderToken, weekOffset, resetProviderTokenCache)
}

export function syncGusCareInvites(gusCare: GusResponsibility[]) {
  return sharedSyncGusCareInvites(getProviderToken, gusCare, {
    attendeeEmail: 'nathaniel.duncan@geaerospace.com',
  })
}

export function createOwnedEvent(fields: CreateOwnedEventFields) {
  return sharedCreateOwnedEvent(getProviderToken, fields, {
    caitieEmail: 'caitante@gmail.com',
    natEmail: 'ncduncan@gmail.com',
  })
}

export function patchOwnedEvent(
  eventId: string,
  calendarId: string,
  fields: { summary?: string; start?: string; end?: string },
) {
  return sharedPatchOwnedEvent(getProviderToken, eventId, calendarId, fields)
}
