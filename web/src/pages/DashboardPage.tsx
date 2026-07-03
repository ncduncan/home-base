import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { format, addDays } from 'date-fns'
import { fetchCalendarEvents, fetchCalendarEventsRange, syncGusCareInvites, CalendarAuthError } from '../lib/calendar'
import { supabase } from '../lib/supabase'
import { fetchWeatherForecast } from '../lib/weather'
import { fetchTasks, fetchAllOpenTasks } from '../lib/asana'
import { fetchOverrides, upsertOverride, deleteOverride, applyOverrides } from '../lib/overrides'
import {
  fetchHomebaseEvents,
  createHomebaseEvent,
  deleteHomebaseEvent,
  homebaseToCalendarEvent,
} from '../lib/homebase-events'
import type { HomebaseEvent } from '../lib/homebase-events'
import { computeGusCare } from '../lib/gus-care'
import type { Session } from '@supabase/supabase-js'
import type { AsanaTask, CalendarEvent, CalendarOverride, WeatherDay } from '../types'
import { OWNER_EMAILS } from '../lib/owners'
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
  const [weekOffset, setWeekOffset] = useState(0)

  // ── Overrides ──────────────────────────────────────────────────────────────
  const [overrides, setOverrides] = useState<CalendarOverride[]>([])

  // ── Home-base events (Supabase-stored, not in Google Calendar) ────────────
  const [homebaseEvents, setHomebaseEvents] = useState<HomebaseEvent[]>([])

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

  const loadOverrides = useCallback((offset: number) => {
    const { start, end } = weekRange(offset)
    fetchOverrides(start, end).then(setOverrides).catch(() => {})
  }, [weekRange])

  const loadHomebaseEvents = useCallback((offset: number) => {
    const { start, end } = weekRange(offset)
    fetchHomebaseEvents(start, end).then(setHomebaseEvents).catch(() => {})
  }, [weekRange])

  // Tracks the latest in-flight fetch so out-of-order responses can be
  // discarded. Without this, rapid Next/Prev clicks issue several fetches
  // and whichever resolves last wins — which can blow away the visible
  // week's events with stale data from a different week.
  const fetchSeqRef = useRef(0)

  const fetchEvents = useCallback((offset: number) => {
    const seq = ++fetchSeqRef.current
    setEventsLoading(true)
    setEventsError(null)
    loadOverrides(offset)
    loadHomebaseEvents(offset)
    fetchCalendarEvents(offset)
      .then(events => {
        if (seq !== fetchSeqRef.current) return // stale response, ignore
        setRawEvents(events)
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
        setEventsError(e instanceof Error ? e.message : 'Failed to load calendar')
      })
      .finally(() => {
        if (seq !== fetchSeqRef.current) return
        setEventsLoading(false)
      })
  }, [loadOverrides, loadHomebaseEvents])

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
  const gusCare = useMemo(() => computeGusCare(events, weekDates), [events, weekDates])

  // Sync Gus care invites to Google Calendar (debounced).
  // Gated to Nat because the OAuth token lives on his personal Google account —
  // syncGusCareInvites writes to that calendar and adds the responsible person
  // (Nat or Caitie) as the attendee for each day.
  //
  // Single-flight: only one sync runs at a time per tab. If the inputs change
  // mid-flight we set a "pending" flag and re-run once the in-flight pass
  // resolves. Combined with PATCH-based reconciliation in syncGusCareInvites,
  // this keeps the calendar from accumulating duplicate Gus invites.
  const syncTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const inFlightRef = useRef(false)
  const pendingRef = useRef(false)
  const [syncTick, setSyncTick] = useState(0)
  useEffect(() => {
    if (session.user.email?.toLowerCase() !== OWNER_EMAILS.nat) return
    if (eventsLoading) return

    clearTimeout(syncTimerRef.current)
    syncTimerRef.current = setTimeout(() => {
      if (inFlightRef.current) {
        pendingRef.current = true
        return
      }
      inFlightRef.current = true
      syncGusCareInvites(gusCare)
        .then(changed => {
          // If the sync updated any Google events, refetch so the dashboard
          // reflects the new attendee/owner state without a manual reload.
          if (changed) fetchEvents(weekOffset)
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
  }, [gusCare, session.user.email, eventsLoading, fetchEvents, weekOffset, syncTick])

  // ── Override handlers ─────────────────────────────────────────────────────
  const handleSaveOverride = useCallback(async (override: Omit<CalendarOverride, 'id'>) => {
    const saved = await upsertOverride(override)
    setOverrides(prev => {
      const filtered = prev.filter(o => !(o.event_key === saved.event_key && o.event_date === saved.event_date))
      return [...filtered, saved]
    })
  }, [])

  const handleDeleteOverride = useCallback(async (id: string) => {
    await deleteOverride(id)
    setOverrides(prev => prev.filter(o => o.id !== id))
  }, [])

  // ── Home-base event handlers ──────────────────────────────────────────────
  const handleCreateHomebaseEvent = useCallback(async (fields: Omit<HomebaseEvent, 'id'>) => {
    const created = await createHomebaseEvent(fields)
    setHomebaseEvents(prev => [...prev, created])
  }, [])

  const handleDeleteHomebaseEvent = useCallback(async (id: string) => {
    await deleteHomebaseEvent(id)
    setHomebaseEvents(prev => prev.filter(e => e.id !== id))
  }, [])

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
          onSaveOverride={handleSaveOverride}
          onDeleteOverride={handleDeleteOverride}
          onCreateHomebaseEvent={handleCreateHomebaseEvent}
          onDeleteHomebaseEvent={handleDeleteHomebaseEvent}
          weekOffset={weekOffset}
          onWeekChange={delta => setWeekOffset(o => o + delta)}
          tasks={tasks}
          setTasks={setTasks}
          tasksLoading={tasksLoading}
          userEmail={session.user.email ?? ''}
          searchableEvents={searchableEvents}
          searchableTasks={searchableTasks}
          extendedLoading={extendedLoading}
          onJumpToResult={handleJumpToResult}
        />
      </main>
    </div>
  )
}
