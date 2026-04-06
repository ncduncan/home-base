import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { format, addDays } from 'date-fns'
import { fetchCalendarEvents, CalendarAuthError, syncGusCareInvites } from '../lib/calendar'
import { fetchWeatherForecast } from '../lib/weather'
import { fetchTasks } from '../lib/asana'
import { fetchOverrides, upsertOverride, deleteOverride, applyOverrides } from '../lib/overrides'
import { computeGusCare } from '../lib/gus-care'
import type { Session } from '@supabase/supabase-js'
import type { AsanaTask, CalendarEvent, CalendarOverride, WeatherDay } from '../types'
import Header from '../components/Header'
import WeekDashboard from '../components/WeekDashboard'

interface Props {
  session: Session
}

export default function DashboardPage({ session }: Props) {
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

  const loadOverrides = useCallback((offset: number) => {
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    now.setDate(now.getDate() - now.getDay() + offset * 7)
    const start = format(now, 'yyyy-MM-dd')
    const end = format(addDays(now, 6), 'yyyy-MM-dd')
    fetchOverrides(start, end).then(setOverrides).catch(() => {})
  }, [])

  const fetchEvents = useCallback((offset: number) => {
    setEventsLoading(true)
    setEventsError(null)
    setEventsAuthError(false)
    Promise.all([
      fetchCalendarEvents(offset),
      (() => { loadOverrides(offset); return undefined })(),
    ])
      .then(([events]) => { if (events) setRawEvents(events) })
      .catch((e: unknown) => {
        if (e instanceof CalendarAuthError) setEventsAuthError(true)
        else setEventsError(e instanceof Error ? e.message : 'Failed to load calendar')
      })
      .finally(() => setEventsLoading(false))
  }, [loadOverrides])

  useEffect(() => { fetchEvents(weekOffset) }, [fetchEvents, weekOffset])

  // Apply overrides to get the display events
  const events = useMemo(() => applyOverrides(rawEvents, overrides), [rawEvents, overrides])

  // ── Gus care (computed from overridden events) ────────────────────────────
  const gusCare = useMemo(() => computeGusCare(events), [events])

  // Sync Gus care invites to Google Calendar (Nat only, debounced)
  const syncTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => {
    if (session.user.email !== 'ncduncan@gmail.com') return
    if (eventsLoading) return

    clearTimeout(syncTimerRef.current)
    syncTimerRef.current = setTimeout(() => {
      syncGusCareInvites(gusCare).catch(() => {/* non-blocking */})
    }, 2000) // 2s debounce

    return () => clearTimeout(syncTimerRef.current)
  }, [gusCare, session.user.email, eventsLoading])

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

  // ── Weather ────────────────────────────────────────────────────────────────
  const [weather, setWeather] = useState<WeatherDay[]>([])

  useEffect(() => {
    fetchWeatherForecast().then(setWeather).catch(() => {/* non-critical */})
  }, [])

  // ──────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50">
      <Header session={session} />
      <main className="px-6 py-6">
        <WeekDashboard
          events={events}
          rawEvents={rawEvents}
          eventsLoading={eventsLoading}
          eventsError={eventsError}
          eventsAuthError={eventsAuthError}
          onRefreshEvents={() => fetchEvents(weekOffset)}
          weather={weather}
          gusCare={gusCare}
          overrides={overrides}
          onSaveOverride={handleSaveOverride}
          onDeleteOverride={handleDeleteOverride}
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
