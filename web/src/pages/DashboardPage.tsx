import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { format, addDays, startOfToday, startOfDay, parseISO } from 'date-fns'
import { RefreshCw } from 'lucide-react'
import { fetchCalendarEvents, CalendarAuthError, syncGusCareInvites, eventOwner } from '../lib/calendar'
import { fetchWeatherForecast } from '../lib/weather'
import { fetchTasks } from '../lib/asana'
import { fetchOverrides, upsertOverride, deleteOverride, applyOverrides } from '../lib/overrides'
import { computeGusCare } from '../lib/gus-care'
import type { Session } from '@supabase/supabase-js'
import type { AsanaTask, CalendarEvent, CalendarOverride, WeatherDay } from '../types'
import Header from '../components/Header'
import CalendarView from '../components/CalendarView'
import AsanaTaskList from '../components/AsanaTaskList'

interface Props {
  session: Session
}

function ConflictBar({ events, weekOffset }: { events: CalendarEvent[]; weekOffset: number }) {
  const today = startOfDay(new Date())
  const sunday = addDays(startOfToday(), -startOfToday().getDay() + weekOffset * 7)
  const conflictDays = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(sunday, i)
    if (date < today) return null
    const dateStr = format(date, 'yyyy-MM-dd')
    const dayEvents = events.filter(e => e.start.startsWith(dateStr))
    const hasCaitie = dayEvents.some(e => eventOwner(e) === 'caitie')
    const hasNat = dayEvents.some(e => eventOwner(e) === 'nat' && e.title !== 'Gus pickup' && e.title !== 'Gus dropoff')
    return (hasCaitie && hasNat) ? dateStr : null
  }).filter(Boolean) as string[]

  if (conflictDays.length === 0) return null

  return (
    <div className="mb-6 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800 flex items-center gap-1.5 flex-wrap">
      <span className="font-semibold">Heads up:</span>
      <span>Both have plans on</span>
      {conflictDays.map((d, i) => (
        <span key={d}>
          <span className="font-semibold">{format(parseISO(`${d}T00:00:00`), 'EEE MMM d')}</span>
          {i < conflictDays.length - 1 ? ',' : ''}
        </span>
      ))}
      <span>-- coordinate Gus care.</span>
    </div>
  )
}

export default function DashboardPage({ session }: Props) {
  // ── Asana tasks ───────────────────────────────────────────────────────────
  const [tasks, setTasks] = useState<AsanaTask[]>([])
  const [tasksLoading, setTasksLoading] = useState(true)
  const [tasksRefreshing, setTasksRefreshing] = useState(false)

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
      <main className="max-w-5xl mx-auto px-4 py-6">

        {!eventsLoading && <ConflictBar events={events} weekOffset={weekOffset} />}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Calendar panel */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <CalendarView
              events={events}
              loading={eventsLoading}
              error={eventsError}
              authError={eventsAuthError}
              onRefresh={() => fetchEvents(weekOffset)}
              weather={weather}
              weekOffset={weekOffset}
              onWeekChange={delta => setWeekOffset(o => o + delta)}
              overrides={overrides}
              onSaveOverride={handleSaveOverride}
              onDeleteOverride={handleDeleteOverride}
              gusCare={gusCare}
              userEmail={session.user.email ?? ''}
            />
          </div>

          {/* Tasks panel */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Tasks</h2>
              <button
                onClick={() => {
                  setTasksRefreshing(true)
                  setTasksLoading(true)
                  fetchTasks().then(setTasks).catch(() => {}).finally(() => {
                    setTasksLoading(false)
                    setTimeout(() => setTasksRefreshing(false), 1200)
                  })
                }}
                disabled={tasksRefreshing}
                className="text-gray-300 hover:text-gray-500 transition-colors disabled:opacity-40"
                aria-label="Refresh tasks"
              >
                <RefreshCw size={13} className={tasksRefreshing ? 'animate-spin' : ''} />
              </button>
            </div>
            <AsanaTaskList
              tasks={tasks}
              loading={tasksLoading}
              currentUserEmail={session.user.email ?? ''}
              onSetTasks={setTasks}
            />
          </div>

        </div>
      </main>
    </div>
  )
}
