import { useEffect, useState, useCallback } from 'react'
import { fetchCalendarEvents, CalendarAuthError } from '../lib/calendar'
import { fetchWeatherForecast } from '../lib/weather'
import { fetchTasks } from '../lib/asana'
import type { Session } from '@supabase/supabase-js'
import type { AsanaTask, CalendarEvent, WeatherDay } from '../types'
import Header from '../components/Header'
import CalendarView from '../components/CalendarView'
import AsanaTaskList from '../components/AsanaTaskList'

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
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [eventsLoading, setEventsLoading] = useState(true)
  const [eventsError, setEventsError] = useState<string | null>(null)
  const [eventsAuthError, setEventsAuthError] = useState(false)
  const [weekOffset, setWeekOffset] = useState(0)

  const fetchEvents = useCallback((offset: number) => {
    setEventsLoading(true)
    setEventsError(null)
    setEventsAuthError(false)
    fetchCalendarEvents(offset)
      .then(setEvents)
      .catch((e: unknown) => {
        if (e instanceof CalendarAuthError) setEventsAuthError(true)
        else setEventsError(e instanceof Error ? e.message : 'Failed to load calendar')
      })
      .finally(() => setEventsLoading(false))
  }, [])

  useEffect(() => { fetchEvents(weekOffset) }, [fetchEvents, weekOffset])

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
            />
          </div>

          {/* Tasks panel */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Tasks</h2>
              <button
                onClick={() => {
                  setTasksLoading(true)
                  fetchTasks().then(setTasks).catch(() => {}).finally(() => setTasksLoading(false))
                }}
                className="text-xs text-gray-400 hover:text-gray-600"
                title="Refresh tasks"
              >
                ↺
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
