import { useEffect, useState } from 'react'
import { format, addDays, startOfToday, startOfDay, parseISO, isSameDay } from 'date-fns'
import { RefreshCw, ChevronLeft, ChevronRight, CalendarPlus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { fetchWorkspaceUsers, fetchMe } from '../lib/asana'
import { ALLOWED_EMAILS, OWNER_EMAILS, NAT_WORK_EMAIL, CAITIE_WORK_EMAIL } from '../lib/owners'
import DayColumn from './DayColumn'
import CompletedRow from './tasks/CompletedRow'
import AddTaskForm from './tasks/AddTaskForm'
import AddEventForm from './AddEventForm'
import DashboardSearch from './search/DashboardSearch'
import { useTaskMutations } from './tasks/useTaskMutations'
import type { HomebaseEvent } from '../lib/homebase-events'
import type {
  AsanaTask,
  AsanaUser,
  CalendarEvent,
  CalendarOverride,
  GusOverride,
  WeatherDay,
} from '../types'

interface Props {
  events: CalendarEvent[]
  rawEvents: CalendarEvent[]
  eventsLoading: boolean
  eventsError: string | null
  onRefreshEvents: () => void
  weather: WeatherDay[]
  overrides: CalendarOverride[]
  onSaveOverride: (override: Omit<CalendarOverride, 'id'>) => Promise<void>
  onDeleteOverride: (id: string) => Promise<void>
  gusOverrides: GusOverride[]
  onSetGusOwner: (date: string, role: 'pickup' | 'dropoff', owner: 'nat' | 'caitie') => Promise<void>
  onClearGusOwner: (date: string, role: 'pickup' | 'dropoff') => Promise<void>
  onCreateHomebaseEvent: (fields: Omit<HomebaseEvent, 'id'>) => Promise<void>
  onDeleteHomebaseEvent: (id: string) => Promise<void>
  weekOffset: number
  onWeekChange: (delta: number) => void
  tasks: AsanaTask[]
  setTasks: React.Dispatch<React.SetStateAction<AsanaTask[]>>
  tasksLoading: boolean
  userEmail: string
  searchableEvents: CalendarEvent[]
  searchableTasks: AsanaTask[]
  extendedLoading: boolean
  onJumpToResult: (id: string, targetOffset: number) => void
}

function weekLabel(weekOffset: number): string {
  if (weekOffset === 0) return 'This Week'
  const today = startOfToday()
  const sunday = addDays(today, -today.getDay() + weekOffset * 7)
  const nextSunday = addDays(sunday, 7)
  if (sunday.getMonth() === nextSunday.getMonth()) {
    return `${format(sunday, 'MMM d')}–${format(nextSunday, 'd')}`
  }
  return `${format(sunday, 'MMM d')}–${format(nextSunday, 'MMM d')}`
}

export default function WeekDashboard({
  events, rawEvents, eventsLoading, eventsError, onRefreshEvents,
  weather, overrides, onSaveOverride, onDeleteOverride,
  gusOverrides, onSetGusOwner, onClearGusOwner,
  onCreateHomebaseEvent, onDeleteHomebaseEvent,
  weekOffset, onWeekChange,
  tasks, setTasks, tasksLoading, userEmail,
  searchableEvents, searchableTasks, extendedLoading, onJumpToResult,
}: Props) {
  const [refreshing, setRefreshing] = useState(false)
  const [users, setUsers] = useState<AsanaUser[]>([])
  const [selfGid, setSelfGid] = useState('')
  const [addMode, setAddMode] = useState<'event' | 'task' | null>(null)

  useEffect(() => {
    // Two-source merge so Drew is filtered out but Nat (the PAT owner) is
    // always included — workspace user listings can omit the email field for
    // the authenticated account, which would otherwise drop him.
    const assigneeAllowed = new Set(
      [...ALLOWED_EMAILS, NAT_WORK_EMAIL, CAITIE_WORK_EMAIL]
        .filter(Boolean)
        .map(e => e.toLowerCase()),
    )
    Promise.all([fetchWorkspaceUsers(), fetchMe().catch(() => null)]).then(([all, me]) => {
      const byGid = new Map<string, AsanaUser>()
      for (const u of all) {
        if (assigneeAllowed.has(u.email.toLowerCase())) byGid.set(u.gid, u)
      }
      if (me) byGid.set(me.gid, me) // PAT owner (Nat) — always include
      const merged = [...byGid.values()]
      setUsers(merged)
      // Default new tasks to Nat regardless of who's logged in.
      const natEmails = [OWNER_EMAILS.nat, NAT_WORK_EMAIL].filter(Boolean).map(e => e.toLowerCase())
      const nat = merged.find(u => natEmails.includes(u.email.toLowerCase())) ?? me ?? null
      if (nat) setSelfGid(nat.gid)
    }).catch(() => {/* non-critical */})
  }, [])

  const mutations = useTaskMutations(tasks, setTasks, users)

  const handleRefresh = () => {
    setRefreshing(true)
    onRefreshEvents()
    setTimeout(() => setRefreshing(false), 1200)
  }

  // 8-day rolling window: Sun + next-Sun peek, rendered as a 4×2 grid.
  // Prev/next still navigates by 7 days — the trailing Sunday is intentional overflow.
  const todayDate = startOfDay(new Date())
  const sunday = addDays(startOfToday(), -startOfToday().getDay() + weekOffset * 7)
  const days = Array.from({ length: 8 }, (_, i) => {
    const date = addDays(sunday, i)
    return { date }
  })

  const weatherByDate = new Map(weather.map(w => [w.date, w]))

  // Task placement: tasks for a specific day, with past-due + undated rolled into today.
  // A task due in the past is shown ONLY under today (not its original due date).
  const todayStr = format(todayDate, 'yyyy-MM-dd')
  function tasksForDay(dayDateStr: string, isToday: boolean): AsanaTask[] {
    return tasks
      .filter(t => {
        if (t.completed) return false
        if (t.due_on === dayDateStr && t.due_on >= todayStr) return true
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

  // Default date for new event/task: today if viewing this week, otherwise the
  // Sunday of the visible week
  const defaultAddDate = weekOffset === 0
    ? format(todayDate, 'yyyy-MM-dd')
    : format(sunday, 'yyyy-MM-dd')

  // ── Header ────────────────────────────────────────────────────────────────
  const header = (
    <div className="mb-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onWeekChange(-1)}
            className="text-hb-fg-muted hover:text-hb-fg transition-colors p-1"
            aria-label="Previous week"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="text-hb-fg-faint hover:text-hb-fg-secondary transition-colors disabled:opacity-40 p-1"
            aria-label="Refresh"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => onWeekChange(1)}
            className="text-hb-fg-muted hover:text-hb-fg transition-colors p-1"
            aria-label="Next week"
          >
            <ChevronRight size={18} />
          </button>
          <button
            onClick={() => onWeekChange(-weekOffset)}
            disabled={weekOffset === 0}
            className="ml-1 text-xs h-7 px-2.5 rounded-md border bg-hb-card text-hb-fg-secondary border-hb-border-soft hover:border-hb-fg-faint transition-colors disabled:opacity-40 disabled:cursor-default whitespace-nowrap shrink-0"
          >
            This week
          </button>
        </div>

        <h2 className="text-sm font-semibold text-hb-fg-secondary uppercase tracking-[.16em] whitespace-nowrap text-center hidden sm:block">
          {weekLabel(weekOffset)}
        </h2>

        <div className="flex items-center gap-2 shrink-0 justify-end">
          <button
            onClick={() => setAddMode(addMode === 'event' ? null : 'event')}
            className={`flex items-center gap-1 text-xs h-7 px-2.5 rounded-md border transition-colors whitespace-nowrap ${
              addMode === 'event'
                ? 'bg-hb-fg text-white border-hb-fg'
                : 'bg-hb-card text-hb-fg-secondary border-hb-border-soft hover:border-hb-fg-faint'
            }`}
          >
            <CalendarPlus size={12} />
            Event
          </button>
          <button
            onClick={() => setAddMode(addMode === 'task' ? null : 'task')}
            className={`flex items-center gap-1 text-xs h-7 px-2.5 rounded-md border transition-colors whitespace-nowrap ${
              addMode === 'task'
                ? 'bg-hb-fg text-white border-hb-fg'
                : 'bg-hb-card text-hb-fg-secondary border-hb-border-soft hover:border-hb-fg-faint'
            }`}
          >
            <Plus size={12} />
            Task
          </button>
        </div>
      </div>

      <div className="mt-3 flex justify-center">
        <div className="w-full sm:max-w-md">
          <DashboardSearch
            events={searchableEvents}
            tasks={searchableTasks}
            loadingMore={extendedLoading}
            onSelectEvent={(e, offset) => onJumpToResult(`event-${e.id}`, offset)}
            onSelectTask={(t, offset) => onJumpToResult(`task-${t.gid}`, offset)}
          />
        </div>
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

      {eventsError && (
        <div className="mb-4 px-4 py-2.5 bg-[#fcf0f0] border border-[#f1d8d8] rounded-md flex items-center justify-between gap-3">
          <p className="text-xs text-red-700">{eventsError}</p>
          <Button variant="outline" size="sm" className="text-xs h-7 shrink-0" onClick={handleRefresh}>
            Retry
          </Button>
        </div>
      )}

      {addMode === 'event' && (
        <div className="mb-4 max-w-2xl mx-auto">
          <AddEventForm
            defaultDate={defaultAddDate}
            currentUserEmail={userEmail}
            onCreate={onCreateHomebaseEvent}
            onClose={() => setAddMode(null)}
          />
        </div>
      )}

      {addMode === 'task' && (
        <div className="mb-4 max-w-2xl mx-auto">
          <AddTaskForm
            users={users}
            selfGid={selfGid}
            defaultDueDate={defaultAddDate}
            onAdd={mutations.addTask}
            onClose={() => setAddMode(null)}
          />
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {days.map(({ date }) => {
          const dayDateStr = format(date, 'yyyy-MM-dd')
          const isToday = isSameDay(date, todayDate)
          const isPast = date < todayDate && !isToday
          const dayEvents = events.filter(e => {
            if (e.all_day && !e.is_amion) {
              const start = parseISO(e.start)
              const end = parseISO(e.end)
              return start <= date && end > date
            }
            return isSameDay(parseISO(e.start), date)
          })
          const dayTasks = tasksForDay(dayDateStr, isToday)
          const hideOnMobile = isPast && weekOffset === 0

          const column = (
            <DayColumn
              key={dayDateStr}
              date={date}
              isToday={isToday}
              isPast={isPast}
              events={dayEvents}
              rawEvents={rawEvents}
              overrides={overrides}
              weather={weatherByDate.get(dayDateStr)}
              tasks={dayTasks}
              users={users}
              userEmail={userEmail}
              onSaveOverride={onSaveOverride}
              onDeleteOverride={onDeleteOverride}
              gusOverrides={gusOverrides}
              onSetGusOwner={onSetGusOwner}
              onClearGusOwner={onClearGusOwner}
              onDeleteHomebaseEvent={onDeleteHomebaseEvent}
              onToggleTask={(gid, c) => void mutations.toggleTask(gid, c)}
              onDeleteTask={(gid) => void mutations.removeTask(gid)}
              onUpdateTask={mutations.editTask}
              todayDate={todayDate}
            />
          )

          return hideOnMobile
            ? <div key={dayDateStr} className="hidden sm:block">{column}</div>
            : column
        })}
      </div>

      {recentlyCompleted.length > 0 && (
        <details className="mt-6 bg-hb-card rounded-md border border-hb-border-soft shadow-sm overflow-hidden">
          <summary className="px-4 py-2.5 text-xs text-hb-fg-muted cursor-pointer hover:text-hb-fg-secondary select-none list-none flex items-center gap-1.5">
            <span className="text-hb-fg-faint">▸</span>
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
