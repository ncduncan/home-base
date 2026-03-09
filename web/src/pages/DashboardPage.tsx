import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { fetchCalendarEvents, CalendarAuthError } from '../lib/calendar'
import { fetchWeatherForecast } from '../lib/weather'
import type { Session } from '@supabase/supabase-js'
import type { Todo, CalendarEvent, WeatherDay } from '../types'
import Header from '../components/Header'
import CalendarView from '../components/CalendarView'
import TodoList from '../components/TodoList'

interface Props {
  session: Session
}

export default function DashboardPage({ session }: Props) {
  // ── Todos ─────────────────────────────────────────────────────────────────
  const [todos, setTodos] = useState<Todo[]>([])
  const [todosLoading, setTodosLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('todos')
      .select('*')
      .order('completed', { ascending: true })
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data) setTodos(data as Todo[])
        setTodosLoading(false)
      })
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
              todos={todos}
              weather={weather}
              weekOffset={weekOffset}
              onWeekChange={delta => setWeekOffset(o => o + delta)}
            />
          </div>

          {/* Todos panel */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">To Do</h2>
            </div>
            <TodoList
              session={session}
              todos={todos}
              loading={todosLoading}
              onSetTodos={setTodos}
            />
          </div>

        </div>
      </main>
    </div>
  )
}
