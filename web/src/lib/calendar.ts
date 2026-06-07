import { supabase } from './supabase'
import { OWNER_EMAILS, NAT_WORK_EMAIL, CAITIE_WORK_EMAIL } from './owners'
import {
  fetchCalendarEvents as sharedFetchCalendarEvents,
  fetchCalendarEventsRange as sharedFetchCalendarEventsRange,
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

/**
 * Thrown when the Edge Function reports that no Google refresh token is stored
 * for this user (HTTP 404). Unlike CalendarAuthError, a plain re-login can't
 * fix this — Google only issues a refresh token during a `prompt=consent` flow.
 * Callers should respond with a one-time consent re-auth (see WeekDashboard).
 */
export class CalendarReauthRequired extends Error {
  constructor() {
    super('Google access needs to be re-granted — one-time consent required')
    this.name = 'CalendarReauthRequired'
  }
}

// localStorage key holding the epoch-ms when the current session.provider_token
// was minted (written by App.tsx on SIGNED_IN). Supabase never updates
// provider_token after issuance, so we use this to detect when it has gone
// stale rather than trusting it indefinitely.
const PROVIDER_TOKEN_AT_KEY = 'hb_provider_token_at'
// Google access tokens live ~1hr; treat the session token as usable only while
// comfortably inside that window, then fall through to the Edge Function.
const PROVIDER_TOKEN_MAX_AGE_MS = 55 * 60_000

function providerTokenIssuedAt(): number {
  try {
    return Number(localStorage.getItem(PROVIDER_TOKEN_AT_KEY)) || 0
  } catch {
    return 0
  }
}

// ── Token cache ───────────────────────────────────────────────────────────────

let cachedToken: string | null = null
let cachedTokenExpiry = 0 // epoch ms
// Set when a 401 is observed mid-request: forces the next getProviderToken() to
// skip the in-memory cache AND the (possibly stale) session.provider_token and
// mint a genuinely fresh token via the Edge Function. Without this, a 401 retry
// would just re-serve the same stale session token and loop.
let forceEdgeRefresh = false

export function resetProviderTokenCache(): void {
  cachedToken = null
  cachedTokenExpiry = 0
  forceEdgeRefresh = false
}

// Fired by the shared fetchers when Google returns 401. Clears the cache and
// latches a forced Edge Function refresh so the retry escalates instead of
// re-serving the stale session token.
function handleTokenRejected(): void {
  resetProviderTokenCache()
  forceEdgeRefresh = true
}

// Reset the cache whenever Supabase emits a new session — keeps us from
// holding a stale Google access_token after a silent refresh or re-login.
supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'SIGNED_OUT') {
    resetProviderTokenCache()
  }
})

// Proactively refresh the Google access token when the tab regains focus and
// the cached token is near expiry. Event-driven rather than a background timer
// (browsers heavily throttle timers in inactive tabs), so returning to a tab
// that's been idle past the 1hr mark finds a warm token ready instead of a
// first-fetch stall. Only runs once we've already minted a token; errors are
// swallowed since this is a warm-up — the real fetch path surfaces auth issues.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    const nearExpiry = cachedToken !== null && Date.now() > cachedTokenExpiry - 10 * 60_000
    if (!nearExpiry) return
    void getProviderToken().catch(() => {/* warm-up only */})
  })
}

async function getProviderToken(): Promise<string> {
  // 1. Use cached token if still valid (5-min buffer). Skipped when a 401 has
  // latched forceEdgeRefresh so a retry can't re-serve a known-bad token.
  if (!forceEdgeRefresh && cachedToken && Date.now() < cachedTokenExpiry - 5 * 60_000) {
    return cachedToken
  }

  // 2. Try the session's provider_token (available right after OAuth login and
  // persisted in localStorage across reloads) — but only while it's still
  // fresh. Supabase never refreshes provider_token, so past ~55min the
  // persisted value is an expired token; trusting it here was the bug that
  // forced an hourly re-login (it short-circuited the Edge Function refresh and
  // a 401 retry just re-served the same stale token). Once stale, fall through
  // to the Edge Function (Tier 3) which mints a fresh token via the stored
  // refresh token — the actual persistent-auth path.
  if (!forceEdgeRefresh) {
    const issuedAt = providerTokenIssuedAt()
    const fresh = issuedAt > 0 && Date.now() - issuedAt < PROVIDER_TOKEN_MAX_AGE_MS
    if (fresh) {
      const { data } = await supabase.auth.getSession()
      const sessionToken = data.session?.provider_token
      if (sessionToken) {
        cachedToken = sessionToken
        cachedTokenExpiry = issuedAt + 60 * 60_000 // ~1hr from when it was minted
        return sessionToken
      }
    }
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

  // 404 means no Google refresh token is stored for this user — a plain
  // re-login won't help (silent SSO won't re-issue one). Surface this distinctly
  // so the UI can run a single prompt=consent flow to (re)capture it.
  if (resp.status === 404) {
    throw new CalendarReauthRequired()
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
  forceEdgeRefresh = false // fresh token minted — clear the 401 latch
  return access_token
}

// ── Public API ────────────────────────────────────────────────────────────────

// Dashboard renders an 8-day grid (Sun + next-Sun peek per WeekDashboard).
// Fetch 8 days so the trailing Sunday's events (e.g. an AMION 24hr call) aren't
// dropped at Google's exclusive timeMax boundary.
export function fetchCalendarEvents(weekOffset = 0) {
  return sharedFetchCalendarEvents(getProviderToken, weekOffset, handleTokenRejected, 8)
}

export function fetchCalendarEventsRange(startISO: string, endISO: string) {
  return sharedFetchCalendarEventsRange(getProviderToken, startISO, endISO, handleTokenRejected)
}

export function syncGusCareInvites(gusCare: GusResponsibility[]) {
  return sharedSyncGusCareInvites(getProviderToken, gusCare, {
    natAttendeeEmail: NAT_WORK_EMAIL,
    caitieAttendeeEmail: CAITIE_WORK_EMAIL,
  })
}

export function createOwnedEvent(fields: CreateOwnedEventFields) {
  return sharedCreateOwnedEvent(getProviderToken, fields, {
    caitieEmail: OWNER_EMAILS.caitie,
    natEmail:    OWNER_EMAILS.nat,
  })
}

export function patchOwnedEvent(
  eventId: string,
  calendarId: string,
  fields: { summary?: string; start?: string; end?: string },
) {
  return sharedPatchOwnedEvent(getProviderToken, eventId, calendarId, fields)
}
