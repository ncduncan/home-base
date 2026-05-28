import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { format, addDays } from 'date-fns'
import { fetchCalendarEvents, CalendarAuthError, syncGusCareInvites } from '../lib/calendar'
import { fetchWeatherForecast } from '../lib/weather'
import { fetchTasks } from '../lib/asana'
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
  const [eventsAuthError, setEventsAuthError] = useState(false)
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
    setEventsAuthError(false)
    loadOverrides(offset)
    loadHomebaseEvents(offset)
    fetchCalendarEvents(offset)
      .then(events => {
        if (seq !== fetchSeqRef.current) return // stale response, ignore
        setRawEvents(events)
      })
      .catch((e: unknown) => {
        if (seq !== fetchSeqRef.current) return
        if (e instanceof CalendarAuthError) setEventsAuthError(true)
        else setEventsError(e instanceof Error ? e.message : 'Failed to load calendar')
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
          eventsAuthError={eventsAuthError}
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
        />
      </main>
    </div>
  )
}
