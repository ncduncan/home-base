import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { format, addDays } from 'date-fns'
import { fetchCalendarEvents, fetchCalendarEventsRange, syncGusCareInvites, CalendarAuthError } from '../lib/calendar'
import { supabase } from '../lib/supabase'
import { fetchWeatherForecast } from '../lib/weather'
import { fetchTasks, fetchAllOpenTasks } from '../lib/asana'
import { fetchOverrides, upsertOverride, deleteOverride, applyOverrides } from '../lib/overrides'
import { fetchGusOverrides, upsertGusOverride, deleteGusOverride } from '../lib/gus-overrides'
import {
  fetchHomebaseEvents,
  createHomebaseEvent,
  deleteHomebaseEvent,
  homebaseToCalendarEvent,
} from '../lib/homebase-events'
import type { HomebaseEvent } from '../lib/homebase-events'
import { computeGusCare } from '../lib/gus-care'
import {
  emptyList, viewOf, receiveServerRows, hasPendingWrites, writeClock, type OptimisticList,
} from '../lib/optimistic'
import { createDashboardMutations } from '../lib/dashboard-mutations'
import { useToast } from '../lib/toast'
import { canSyncGusInvites } from '../lib/gus-sync-gate'
import type { Session } from '@supabase/supabase-js'
import type { AsanaTask, CalendarEvent, CalendarOverride, GusOverride, WeatherDay } from '../types'
import Header from '../components/Header'
import WeekDashboard from '../components/WeekDashboard'

interface Props {
  session: Session
  tab: 'home' | 'goals'
  onTabChange: (tab: 'home' | 'goals') => void
}

export default function DashboardPage({ session, tab, onTabChange }: Props) {
  // ── Asana tasks ───────────────────────────────────────────────────────────
  const [tasks, setTasks] = useState<AsanaTask[]>([])
  const [tasksLoading, setTasksLoading] = useState(true)

  useEffect(() => {
    fetchTasks()
      .then(setTasks)
      .catch(() => {/* show empty on error */})
      .finally(() => setTasksLoading(false))
  }, [])

  // ── Calendar events ────────────────────────────────────────────────────────
  const [rawEvents, setRawEvents] = useState<CalendarEvent[]>([])
  const [eventsLoading, setEventsLoading] = useState(true)
  const [eventsError, setEventsError] = useState<string | null>(null)
  // Calendar sources that failed to read on the latest fetch. Non-zero means
  // the picture is incomplete, so the Gus sync must not write from it.
  const [failedSources, setFailedSources] = useState(0)
  const [weekOffset, setWeekOffset] = useState(0)

  // Overrides, Gus overrides and home-base events are optimistic lists: the
  // last server read plus in-flight writes layered on top (lib/optimistic.ts).
  // Edits show instantly, a failed write drops its layer (the rollback), and a
  // refetch replaces only the server rows, so it can't undo a pending change.

  // ── Overrides ──────────────────────────────────────────────────────────────
  const [overridesList, setOverridesList] = useState<OptimisticList<CalendarOverride>>(emptyList)
  const overrides = useMemo(() => viewOf(overridesList), [overridesList])

  // ── Gus assignment overrides (manual pickup/dropoff reassignment) ──────────
  const [gusOverridesList, setGusOverridesList] = useState<OptimisticList<GusOverride>>(emptyList)
  const gusOverrides = useMemo(() => viewOf(gusOverridesList), [gusOverridesList])
  // Whether gus_overrides for the current week have landed. The sync must wait
  // for these: syncing before they arrive would write the algorithmic default
  // (with real invite emails) and then correct itself moments later.
  const [gusOverridesReady, setGusOverridesReady] = useState(false)

  // ── Home-base events (Supabase-stored, not in Google Calendar) ────────────
  const [homebaseList, setHomebaseList] = useState<OptimisticList<HomebaseEvent>>(emptyList)
  const homebaseEvents = useMemo(() => viewOf(homebaseList), [homebaseList])

  // Any write still waiting on the server. The Gus invite sync must not run
  // while one is in flight: an unconfirmed change that then fails would sync
  // twice — out and back — and send real invites and cancellations.
  const writesPending = hasPendingWrites(gusOverridesList)
    || hasPendingWrites(overridesList)
    || hasPendingWrites(homebaseList)

  // 8-day window matches the dashboard's Sun + next-Sun peek so overrides and
  // homebase events on the trailing Sunday are included.
  const weekRange = useCallback((offset: number) => {
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    now.setDate(now.getDate() - now.getDay() + offset * 7)
    const start = format(now, 'yyyy-MM-dd')
    const end = format(addDays(now, 7), 'yyyy-MM-dd')
    return { start, end }
  }, [])

  // Tracks the latest in-flight fetch so out-of-order responses can be
  // discarded. Without this, rapid Next/Prev clicks issue several fetches
  // and whichever resolves last wins — which can blow away the visible
  // week's events with stale data from a different week.
  const fetchSeqRef = useRef(0)

  // `startedAt` is the write clock when the fetch was issued; writes confirmed
  // after it keep their layer, since this response may predate them.
  const loadOverrides = useCallback((offset: number, seq: number, startedAt: number) => {
    const { start, end } = weekRange(offset)
    fetchOverrides(start, end)
      .then(rows => {
        if (seq === fetchSeqRef.current) setOverridesList(s => receiveServerRows(s, rows, startedAt))
      })
      .catch(() => {})
  }, [weekRange])

  // Sequence-guarded like the calendar fetch, so paging weeks can't apply the
  // previous week's override rows to the new week. `gusOverridesReady` gates
  // the calendar sync — on failure it stays false, which keeps the sync from
  // writing an assignment that a manual override was about to change.
  const loadGusOverrides = useCallback((offset: number, seq: number, startedAt: number) => {
    const { start, end } = weekRange(offset)
    fetchGusOverrides(start, end)
      .then(rows => {
        if (seq !== fetchSeqRef.current) return
        setGusOverridesList(s => receiveServerRows(s, rows, startedAt))
        setGusOverridesReady(true)
      })
      .catch(() => {})
  }, [weekRange])

  const loadHomebaseEvents = useCallback((offset: number, seq: number, startedAt: number) => {
    const { start, end } = weekRange(offset)
    fetchHomebaseEvents(start, end)
      .then(rows => {
        if (seq === fetchSeqRef.current) setHomebaseList(s => receiveServerRows(s, rows, startedAt))
      })
      .catch(() => {})
  }, [weekRange])

  // Whether a visible (non-silent) load is in flight. Read from callbacks only.
  const loudFetchRef = useRef(false)

  // `silent` is the post-sync check that Google matches: same week, data
  // already on screen, so it shows no loading state and keeps the sync gates
  // (gusOverridesReady) as they are. Week changes and first load stay loud.
  const fetchEvents = useCallback((offset: number, opts: { silent?: boolean } = {}) => {
    const silent = opts.silent === true
    // A silent refetch must never supersede a visible load: bumping the
    // sequence would discard that load's `finally` and leave the week stuck on
    // its loading state. The visible load brings fresh data anyway.
    if (silent && loudFetchRef.current) return
    const seq = ++fetchSeqRef.current
    const startedAt = writeClock()
    if (!silent) {
      loudFetchRef.current = true
      setEventsLoading(true)
      setEventsError(null)
      setGusOverridesReady(false)
    }
    loadOverrides(offset, seq, startedAt)
    loadGusOverrides(offset, seq, startedAt)
    loadHomebaseEvents(offset, seq, startedAt)
    fetchCalendarEvents(offset)
      .then(({ events, failedSources: failed }) => {
        if (seq !== fetchSeqRef.current) return // stale response, ignore
        setRawEvents(events)
        setFailedSources(failed)
      })
      .catch((e: unknown) => {
        if (seq !== fetchSeqRef.current) return
        // A dead/unrecoverable session can't be fixed in place — sign out so the
        // app falls back to LoginPage instead of showing a silently empty
        // calendar. (Asana uses a bundled key, so the rest of the page would
        // otherwise keep rendering and mask the auth failure.)
        if (e instanceof CalendarAuthError) {
          void supabase.auth.signOut()
          return
        }
        // A failed background check keeps what's on screen rather than
        // replacing the week with an error.
        if (silent) {
          console.error('Background calendar refetch failed:', e)
          return
        }
        setEventsError(e instanceof Error ? e.message : 'Failed to load calendar')
      })
      .finally(() => {
        if (seq !== fetchSeqRef.current) return
        loudFetchRef.current = false
        setEventsLoading(false)
      })
  }, [loadOverrides, loadGusOverrides, loadHomebaseEvents])

  // Fetching from an external system is what effects are for; the rule trips on
  // the loading/error flags fetchEvents resets synchronously before the request.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchEvents(weekOffset) }, [fetchEvents, weekOffset])

  // Merge homebase events into the raw event list, then apply overrides
  const events = useMemo(() => {
    const merged = [...rawEvents, ...homebaseEvents.map(homebaseToCalendarEvent)]
    return applyOverrides(merged, overrides)
  }, [rawEvents, homebaseEvents, overrides])

  // ── Gus care (computed from overridden events) ────────────────────────────
  // Always compute for every weekday in the visible week, so days with no events
  // still get a Gus care entry (defaulting to Caitie when she's free).
  const weekDates = useMemo(() => {
    const sun = new Date()
    sun.setHours(0, 0, 0, 0)
    sun.setDate(sun.getDate() - sun.getDay() + weekOffset * 7)
    return Array.from({ length: 7 }, (_, i) => format(addDays(sun, i), 'yyyy-MM-dd'))
  }, [weekOffset])
  const gusCare = useMemo(
    () => computeGusCare(events, weekDates, gusOverrides),
    [events, weekDates, gusOverrides],
  )

  // Sync Gus care invites to Google Calendar (debounced).
  //
  // Keyed on the CONTENT of gusCare, not the array's identity. gusCare is a memo
  // that produces a fresh array on every event refetch, and a successful sync
  // triggers exactly such a refetch — so keying on identity made the effect
  // re-arm itself indefinitely, roughly every 2s, for as long as the tab was
  // open. With a content key, a refetch that yields the same responsibilities is
  // a no-op and the loop terminates.
  //
  // Not gated to Nat: calendar access runs through the calendar-ops Edge
  // Function on a shared server-side credential, so Caitie's session can write
  // too and her manual overrides take effect immediately. Two writers is safe —
  // the sync derives deterministic event ids, so concurrent passes converge on
  // the same event instead of duplicating it.
  const gusCareKey = useMemo(
    () => gusCare.map(g => `${g.date}:${g.pickup}:${g.dropoff}`).join('|'),
    [gusCare],
  )
  // Latest values, read inside the timeout. Keeping them out of the dep array
  // is what lets the effect key purely on content; it also fixes a stale-week
  // bug where an in-flight sync's refetch used the weekOffset captured at
  // schedule time and overwrote whichever week the user had since paged to.
  const syncInputsRef = useRef({ gusCare, weekOffset, fetchEvents })
  // Updated in an effect rather than during render: a render can be discarded
  // under concurrent React, and the sync reads this 2s later from a timeout —
  // long after effects have flushed — so post-commit is both safe and timely.
  useEffect(() => {
    syncInputsRef.current = { gusCare, weekOffset, fetchEvents }
  })

  // Single-flight: only one sync runs at a time per tab. If the inputs change
  // mid-flight we set a "pending" flag and re-run once the in-flight pass
  // resolves.
  const syncTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const inFlightRef = useRef(false)
  const pendingRef = useRef(false)
  const [syncTick, setSyncTick] = useState(0)
  useEffect(() => {
    // Never write from an incomplete picture, or while a write is unconfirmed.
    // When this flips to false the cleanup has already cancelled any armed
    // timer, so a change made mid-debounce can't sync before it's saved.
    if (!canSyncGusInvites({
      eventsLoading, eventsError, failedSources, gusOverridesReady, writesPending, gusCareKey,
    })) return

    clearTimeout(syncTimerRef.current)
    syncTimerRef.current = setTimeout(() => {
      if (inFlightRef.current) {
        pendingRef.current = true
        return
      }
      inFlightRef.current = true
      const { gusCare: care } = syncInputsRef.current
      syncGusCareInvites(care)
        .then(changed => {
          // Only refetch when Google actually changed. Once converged the sync
          // reports false, so this settles after a single pass. Silent: it's a
          // consistency check, not a reload, and reads the week shown *now*.
          if (!changed) return
          const { weekOffset: offset, fetchEvents: refetch } = syncInputsRef.current
          refetch(offset, { silent: true })
        })
        .catch(err => {
          // Don't block the UI but do surface the error in console so the
          // user can debug a misbehaving sync (rare, but better than silent).
          console.error('syncGusCareInvites failed:', err)
        })
        .finally(() => {
          inFlightRef.current = false
          if (pendingRef.current) {
            pendingRef.current = false
            setSyncTick(t => t + 1)
          }
        })
    }, 2000) // 2s debounce

    return () => clearTimeout(syncTimerRef.current)
  }, [gusCareKey, eventsLoading, eventsError, failedSources, gusOverridesReady, writesPending, syncTick])

  // ── Write handlers (optimistic; see lib/dashboard-mutations.ts) ──────────
  // Setting a Gus owner writes a gus_override that wins over the algorithm; the
  // gusCare memo recomputes and, once the write confirms, the debounced sync
  // effect re-syncs the Google Calendar invite.
  const notify = useToast()
  const userEmail = session.user.email ?? ''
  const mutations = useMemo(() => createDashboardMutations({
    overrides: { update: setOverridesList },
    gusOverrides: { update: setGusOverridesList },
    homebaseEvents: { update: setHomebaseList },
    api: {
      upsertOverride, deleteOverride,
      upsertGusOverride, deleteGusOverride,
      createHomebaseEvent, deleteHomebaseEvent,
    },
    notify,
    userEmail,
  }), [notify, userEmail])

  // ── Weather ────────────────────────────────────────────────────────────────
  const [weather, setWeather] = useState<WeatherDay[]>([])

  useEffect(() => {
    fetchWeatherForecast().then(setWeather).catch(() => {/* non-critical */})
  }, [])

  // ── Extended search index (±90 days, lazy-loaded) ─────────────────────────
  // Loaded ~500ms after mount so the critical-path week fetch + weather + Gus
  // sync get the foreground. Keeps the dashboard search bar useful for events
  // and open tasks outside the currently-rendered week.
  const [extendedEvents, setExtendedEvents] = useState<CalendarEvent[]>([])
  const [extendedTasks, setExtendedTasks] = useState<AsanaTask[]>([])
  const [extendedLoading, setExtendedLoading] = useState(false)
  const extendedSeqRef = useRef(0)

  const loadExtended = useCallback(async () => {
    const seq = ++extendedSeqRef.current
    setExtendedLoading(true)
    const today = new Date()
    const start = format(addDays(today, -90), 'yyyy-MM-dd')
    const end = format(addDays(today, 90), 'yyyy-MM-dd')
    try {
      const [cal, openTasks, hb] = await Promise.all([
        fetchCalendarEventsRange(start, end).catch(() => [] as CalendarEvent[]),
        fetchAllOpenTasks().catch(() => [] as AsanaTask[]),
        fetchHomebaseEvents(start, end).catch(() => [] as HomebaseEvent[]),
      ])
      if (seq !== extendedSeqRef.current) return
      setExtendedEvents([...cal, ...hb.map(homebaseToCalendarEvent)])
      setExtendedTasks(openTasks)
    } finally {
      if (seq === extendedSeqRef.current) setExtendedLoading(false)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => { void loadExtended() }, 500)
    return () => clearTimeout(t)
  }, [loadExtended])

  // Merged searchable lists — current-week wins on collisions because it has
  // overrides applied via the existing applyOverrides pipeline.
  const searchableEvents = useMemo(() => {
    const byId = new Map<string, CalendarEvent>()
    for (const e of extendedEvents) byId.set(e.id, e)
    for (const e of events) byId.set(e.id, e)
    return [...byId.values()]
  }, [events, extendedEvents])

  const searchableTasks = useMemo(() => {
    const byGid = new Map<string, AsanaTask>()
    for (const t of extendedTasks) byGid.set(t.gid, t)
    for (const t of tasks) byGid.set(t.gid, t)
    return [...byGid.values()]
  }, [tasks, extendedTasks])

  // ── Search result navigation ──────────────────────────────────────────────
  // Cross-week selection waits for the destination week's fetch to settle
  // before scrolling to the DOM node (which only mounts after re-render).
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const [pendingHighlight, setPendingHighlight] = useState<{ id: string; offset: number } | null>(null)

  const handleJumpToResult = useCallback((id: string, targetOffset: number) => {
    if (targetOffset === weekOffset) {
      setHighlightedId(id)
    } else {
      setPendingHighlight({ id, offset: targetOffset })
      setWeekOffset(targetOffset)
    }
  }, [weekOffset])

  useEffect(() => {
    if (!pendingHighlight) return
    if (pendingHighlight.offset !== weekOffset) return
    if (eventsLoading) return
    const raf = requestAnimationFrame(() => {
      setHighlightedId(pendingHighlight.id)
      setPendingHighlight(null)
    })
    return () => cancelAnimationFrame(raf)
  }, [pendingHighlight, weekOffset, eventsLoading])

  useEffect(() => {
    if (!highlightedId) return
    const el = document.querySelector(`[data-search-id="${highlightedId}"]`)
    if (!el) {
      // DOM node didn't render (e.g. task due outside the visible week).
      // Defer the clear so the effect doesn't synchronously trigger a re-render.
      const id = setTimeout(() => setHighlightedId(null), 0)
      return () => clearTimeout(id)
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('hb-search-flash')
    const t = setTimeout(() => {
      el.classList.remove('hb-search-flash')
      setHighlightedId(null)
    }, 2000)
    return () => clearTimeout(t)
  }, [highlightedId])

  // ──────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-hb-page">
      <Header session={session} tab={tab} onTabChange={onTabChange} />
      <main className="px-6 py-6">
        <WeekDashboard
          events={events}
          rawEvents={rawEvents}
          eventsLoading={eventsLoading}
          eventsError={eventsError}
          onRefreshEvents={() => fetchEvents(weekOffset)}
          weather={weather}
          overrides={overrides}
          onSaveOverride={mutations.saveOverride}
          onDeleteOverride={mutations.deleteOverride}
          gusOverrides={gusOverrides}
          onSetGusOwner={mutations.setGusOwner}
          onClearGusOwner={mutations.clearGusOwner}
          onCreateHomebaseEvent={mutations.createHomebaseEvent}
          onDeleteHomebaseEvent={mutations.deleteHomebaseEvent}
          weekOffset={weekOffset}
          onWeekChange={delta => setWeekOffset(o => o + delta)}
          tasks={tasks}
          setTasks={setTasks}
          tasksLoading={tasksLoading}
          userEmail={userEmail}
          searchableEvents={searchableEvents}
          searchableTasks={searchableTasks}
          extendedLoading={extendedLoading}
          onJumpToResult={handleJumpToResult}
        />
      </main>
    </div>
  )
}
