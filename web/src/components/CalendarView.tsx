import { useCallback, useState } from 'react'
import { format, parseISO, isSameDay, addDays, startOfToday } from 'date-fns'
import { RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { wmoToIcon } from '../lib/weather'
import type { AsanaTask, CalendarEvent, WeatherDay } from '../types'

interface Props {
  events: CalendarEvent[]
  loading: boolean
  error: string | null
  authError: boolean
  onRefresh: () => void
  tasks: AsanaTask[]
  weather: WeatherDay[]
  weekOffset: number
  onWeekChange: (delta: number) => void
}

function amionBadge(kind: CalendarEvent['amion_kind']) {
  switch (kind) {
    case 'working':  return <Badge className="text-xs border-0 py-0 bg-teal-100 text-teal-700">Working</Badge>
    case 'oncall':   return <Badge className="text-xs border-0 py-0 bg-orange-100 text-orange-700">On Call</Badge>
    case 'backup':   return <Badge className="text-xs border-0 py-0 bg-gray-100 text-gray-500">Backup</Badge>
    case 'vacation': return <Badge className="text-xs border-0 py-0 bg-purple-100 text-purple-700">Vacation</Badge>
    default:         return <Badge variant="secondary" className="text-xs border-0 py-0">AMION</Badge>
  }
}

function formatAmionTime(event: CalendarEvent): string {
  if (event.all_day) return 'all day'
  const start = parseISO(event.start)
  const end = parseISO(event.end)
  // Check if end is next day (on-call)
  const startDate = event.start.slice(0, 10)
  const endDate = event.end.slice(0, 10)
  if (startDate !== endDate) {
    return `${format(start, 'h a')}–${format(end, 'h a')} +1`
  }
  return `${format(start, 'h')}–${format(end, 'h a')}`
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

export default function CalendarView({
  events, loading, error, authError, onRefresh, tasks,
  weather, weekOffset, onWeekChange,
}: Props) {
  const [refreshing, setRefreshing] = useState(false)

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    onRefresh()
    setTimeout(() => setRefreshing(false), 1200)
  }, [onRefresh])

  const weatherByDate = new Map(weather.map(w => [w.date, w]))

  // ── Header (always shown) ─────────────────────────────────────────────────
  const header = (
    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
      <button
        onClick={() => onWeekChange(-1)}
        className="text-gray-400 hover:text-gray-600 transition-colors p-0.5"
        aria-label="Previous week"
      >
        <ChevronLeft size={15} />
      </button>
      <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
        {weekLabel(weekOffset)}
      </h2>
      <div className="flex items-center gap-2">
        <button
          onClick={() => void handleRefresh()}
          disabled={refreshing}
          className="text-gray-300 hover:text-gray-500 transition-colors disabled:opacity-40"
          aria-label="Refresh calendar"
        >
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
        </button>
        <button
          onClick={() => onWeekChange(1)}
          className="text-gray-400 hover:text-gray-600 transition-colors p-0.5"
          aria-label="Next week"
        >
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  )

  if (loading) return <div>{header}<div className="p-4 text-gray-400 text-sm">Loading calendar...</div></div>

  if (authError) {
    return (
      <div>
        {header}
        <div className="p-4 space-y-2">
          <p className="text-sm text-amber-600">
            Calendar session expired. Sign out and back in to refresh.
          </p>
          <Button variant="outline" size="sm" onClick={() => void supabase.auth.signOut()}>
            Sign out
          </Button>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div>
        {header}
        <div className="p-4 space-y-2">
          <p className="text-red-500 text-sm">{error}</p>
          <Button variant="outline" size="sm" onClick={handleRefresh}>Retry</Button>
        </div>
      </div>
    )
  }

  const today = format(new Date(), 'yyyy-MM-dd')
  const incompleteTasksWithDue = tasks.filter((t: AsanaTask) => !t.completed && t.due_on && t.due_on >= today)

  if (!events.length && !incompleteTasksWithDue.length) {
    return <div>{header}<div className="p-4 text-gray-400 text-sm">Nothing on the calendar this week.</div></div>
  }

  // Group events by day
  const days: { date: Date; events: CalendarEvent[] }[] = []
  for (const event of events) {
    const d = parseISO(event.start)
    const existing = days.find(g => isSameDay(g.date, d))
    if (existing) existing.events.push(event)
    else days.push({ date: d, events: [event] })
  }

  // Also collect days that only have tasks (no events)
  for (const task of incompleteTasksWithDue) {
    const d = parseISO(task.due_on!)
    if (!days.find(g => isSameDay(g.date, d))) {
      days.push({ date: d, events: [] })
    }
  }
  days.sort((a, b) => a.date.getTime() - b.date.getTime())

  return (
    <div>
      {header}

      {days.map(({ date, events: dayEvents }) => {
        const dayDateStr = format(date, 'yyyy-MM-dd')
        const dayTasks = incompleteTasksWithDue.filter((t: AsanaTask) => t.due_on === dayDateStr)
        const wx = weatherByDate.get(dayDateStr)

        return (
          <div key={date.toISOString()} className="border-b border-gray-50 last:border-0">
            <div className="px-4 py-2 bg-gray-50/60 flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                {format(date, 'EEEE, MMM d')}
              </span>
              {wx && (
                <span className="text-xs text-gray-400 flex items-center gap-1">
                  <span>{wmoToIcon(wx.weatherCode)}</span>
                  <span>{wx.tempMin}–{wx.tempMax}°F</span>
                </span>
              )}
            </div>

            {/* Calendar events */}
            {dayEvents.length > 0 && (
              <ul>
                {dayEvents.map(event => (
                  <li key={event.id} className="flex gap-3 px-4 py-2.5 items-start hover:bg-gray-50/50">
                    <div className="w-16 shrink-0 text-xs text-gray-400 pt-0.5">
                      {event.is_amion
                        ? formatAmionTime(event)
                        : event.all_day ? 'all day' : format(parseISO(event.start), 'h:mm a')}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {!event.is_amion && (
                          <span className="text-sm text-gray-900">{event.title}</span>
                        )}
                        {event.is_amion
                          ? amionBadge(event.amion_kind)
                          : null}
                      </div>
                      {event.location && !event.is_amion && (
                        <div className="text-xs text-gray-400 mt-0.5 truncate">{event.location}</div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {/* Due tasks for this day */}
            {dayTasks.length > 0 && (
              <ul className={dayEvents.length > 0 ? 'border-t border-dashed border-gray-100' : ''}>
                {dayTasks.map((task: AsanaTask) => (
                  <li key={task.gid} className="flex gap-3 px-4 py-1.5 items-center hover:bg-gray-50/50">
                    <div className="w-16 shrink-0 text-xs text-gray-300">due</div>
                    <span className="text-xs text-gray-500 truncate flex-1">{task.name}</span>
                    {task.assignee && (
                      <span className="text-xs text-gray-300">{task.assignee.name.split(' ')[0]}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}
