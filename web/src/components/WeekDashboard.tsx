import { useEffect, useState } from 'react'
import { format, addDays, startOfToday, startOfDay, parseISO, isSameDay } from 'date-fns'
import { RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Button } from '@/components/ui/button'
import { fetchWorkspaceUsers } from '../lib/asana'
import DayColumn from './DayColumn'
import CompletedRow from './tasks/CompletedRow'
import { useTaskMutations } from './tasks/useTaskMutations'
import type { HomebaseEvent } from '../lib/homebase-events'
import type {
  AsanaTask,
  AsanaUser,
  CalendarEvent,
  CalendarOverride,
  GusResponsibility,
  WeatherDay,
} from '../types'

interface Props {
  events: CalendarEvent[]
  rawEvents: CalendarEvent[]
  eventsLoading: boolean
  eventsError: string | null
  eventsAuthError: boolean
  onRefreshEvents: () => void
  weather: WeatherDay[]
  gusCare: GusResponsibility[]
  overrides: CalendarOverride[]
  onSaveOverride: (override: Omit<CalendarOverride, 'id'>) => Promise<void>
  onDeleteOverride: (id: string) => Promise<void>
  onCreateHomebaseEvent: (fields: Omit<HomebaseEvent, 'id'>) => Promise<void>
  onDeleteHomebaseEvent: (id: string) => Promise<void>
  weekOffset: number
  onWeekChange: (delta: number) => void
  tasks: AsanaTask[]
  setTasks: React.Dispatch<React.SetStateAction<AsanaTask[]>>
  tasksLoading: boolean
  userEmail: string
}

function weekLabel(weekOffset: number): string {
  if (weekOffset === 0) return 'This Week'
  const today = startOfToday()
  const sunday = addDays(today, -today.getDay() + weekOffset * 7)
  const saturday = addDays(sunday, 6)
  if (sunday.getMonth() === saturday.getMonth()) {
    return `${format(sunday, 'MMM d')}–${format(saturday, 'd')}`
  }
  return `${format(sunday, 'MMM d')}–${format(saturday, 'MMM d')}`
}

export default function WeekDashboard({
  events, rawEvents, eventsLoading, eventsError, eventsAuthError, onRefreshEvents,
  weather, gusCare, overrides, onSaveOverride, onDeleteOverride,
  onCreateHomebaseEvent, onDeleteHomebaseEvent,
  weekOffset, onWeekChange,
  tasks, setTasks, tasksLoading, userEmail,
}: Props) {
  const [refreshing, setRefreshing] = useState(false)
  const [users, setUsers] = useState<AsanaUser[]>([])
  const [selfGid, setSelfGid] = useState('')

  useEffect(() => {
    console.log('[home-base] WeekDashboard mounted — build with event-creation logging v2')
    fetchWorkspaceUsers().then(all => {
      setUsers(all)
      const self = all.find(u => u.email === userEmail)
      if (self) setSelfGid(self.gid)
    }).catch(() => {/* non-critical */})
  }, [userEmail])

  const mutations = useTaskMutations(tasks, setTasks, users)

  const handleRefresh = () => {
    setRefreshing(true)
    onRefreshEvents()
    setTimeout(() => setRefreshing(false), 1200)
  }

  // Build the 7-day grid
  const todayDate = startOfDay(new Date())
  const sunday = addDays(startOfToday(), -startOfToday().getDay() + weekOffset * 7)
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(sunday, i)
    return { date }
  })

  const weatherByDate = new Map(weather.map(w => [w.date, w]))
  const gusCareByDate = new Map(gusCare.map(g => [g.date, g]))

  // Task placement: tasks for a specific day, with past-due + undated rolled into today
  const todayStr = format(todayDate, 'yyyy-MM-dd')
  function tasksForDay(dayDateStr: string, isToday: boolean): AsanaTask[] {
    return tasks
      .filter(t => {
        if (t.completed) return false
        if (t.due_on === dayDateStr) return true
        if (isToday) {
          if (t.due_on === null) return true
          if (t.due_on && t.due_on < todayStr) return true
        }
        return false
      })
      .sort((a, b) => {
        // Overdue first (sort by due_on asc), then null at end
        if (!a.due_on && !b.due_on) return 0
        if (!a.due_on) return 1
        if (!b.due_on) return -1
        return a.due_on.localeCompare(b.due_on)
      })
  }

  const recentlyCompleted = tasks
    .filter(t => t.completed)
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))

  // ── Header ────────────────────────────────────────────────────────────────
  const header = (
    <div className="flex items-center justify-between mb-4">
      <button
        onClick={() => onWeekChange(-1)}
        className="text-gray-400 hover:text-gray-700 transition-colors p-1"
        aria-label="Previous week"
      >
        <ChevronLeft size={18} />
      </button>
      <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-widest">
        {weekLabel(weekOffset)}
      </h2>
      <div className="flex items-center gap-2">
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="text-gray-300 hover:text-gray-600 transition-colors disabled:opacity-40 p-1"
          aria-label="Refresh"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
        </button>
        <button
          onClick={() => onWeekChange(1)}
          className="text-gray-400 hover:text-gray-700 transition-colors p-1"
          aria-label="Next week"
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  )

  if (eventsLoading && tasksLoading && events.length === 0) {
    return (
      <div>
        {header}
        <div className="p-8 text-center text-gray-400 text-sm">Loading...</div>
      </div>
    )
  }

  return (
    <div>
      {header}

      {eventsAuthError && (
        <div className="mb-4 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between gap-3">
          <p className="text-xs text-amber-700">
            Calendar session expired — events may be stale.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-7 shrink-0"
            onClick={() => void supabase.auth.signInWithOAuth({
              provider: 'google',
              options: {
                scopes: 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events',
                redirectTo: window.location.href,
              },
            })}
          >
            Reconnect
          </Button>
        </div>
      )}

      {eventsError && (
        <div className="mb-4 px-4 py-2.5 bg-red-50 border border-red-200 rounded-xl flex items-center justify-between gap-3">
          <p className="text-xs text-red-700">{eventsError}</p>
          <Button variant="outline" size="sm" className="text-xs h-7 shrink-0" onClick={handleRefresh}>
            Retry
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-7 gap-2.5">
        {days.map(({ date }) => {
          const dayDateStr = format(date, 'yyyy-MM-dd')
          const isToday = isSameDay(date, todayDate)
          const isPast = date < todayDate && !isToday
          const dayEvents = events.filter(e => isSameDay(parseISO(e.start), date))
          const dayTasks = tasksForDay(dayDateStr, isToday)

          return (
            <DayColumn
              key={dayDateStr}
              date={date}
              isToday={isToday}
              isPast={isPast}
              events={dayEvents}
              rawEvents={rawEvents}
              overrides={overrides}
              weather={weatherByDate.get(dayDateStr)}
              gusCare={gusCareByDate.get(dayDateStr)}
              tasks={dayTasks}
              users={users}
              selfGid={selfGid}
              userEmail={userEmail}
              onSaveOverride={onSaveOverride}
              onDeleteOverride={onDeleteOverride}
              onCreateHomebaseEvent={onCreateHomebaseEvent}
              onDeleteHomebaseEvent={onDeleteHomebaseEvent}
              onRefreshEvents={onRefreshEvents}
              onAddTask={mutations.addTask}
              onToggleTask={(gid, c) => void mutations.toggleTask(gid, c)}
              onDeleteTask={(gid) => void mutations.removeTask(gid)}
              onUpdateTask={mutations.editTask}
            />
          )
        })}
      </div>

      {recentlyCompleted.length > 0 && (
        <details className="mt-6 bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <summary className="px-4 py-2.5 text-xs text-gray-400 cursor-pointer hover:text-gray-600 select-none list-none flex items-center gap-1.5">
            <span className="text-gray-300">▸</span>
            Completed recently ({recentlyCompleted.length})
          </summary>
          <ul>
            {recentlyCompleted.map(task => (
              <CompletedRow
                key={task.gid}
                task={task}
                onUncomplete={() => void mutations.toggleTask(task.gid, false)}
                onDelete={() => void mutations.removeTask(task.gid)}
              />
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
