import { useCallback, useState } from 'react'
import { format, parseISO, isSameDay } from 'date-fns'
import { RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { CalendarEvent, Todo } from '../types'

interface Props {
  events: CalendarEvent[]
  loading: boolean
  error: string | null
  authError: boolean
  onRefresh: () => void
  todos: Todo[]
}

export default function CalendarView({ events, loading, error, authError, onRefresh, todos }: Props) {
  const [refreshing, setRefreshing] = useState(false)

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    onRefresh()
    // Give a brief spin animation
    setTimeout(() => setRefreshing(false), 1200)
  }, [onRefresh])

  if (loading) return <div className="p-4 text-gray-400 text-sm">Loading calendar...</div>

  if (authError) {
    return (
      <div className="p-4 space-y-2">
        <p className="text-sm text-amber-600">
          Calendar session expired. Sign out and back in to refresh.
        </p>
        <Button variant="outline" size="sm" onClick={() => void supabase.auth.signOut()}>
          Sign out
        </Button>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 space-y-2">
        <p className="text-red-500 text-sm">{error}</p>
        <Button variant="outline" size="sm" onClick={handleRefresh}>Retry</Button>
      </div>
    )
  }

  if (!events.length && !todos.some(t => !t.completed && t.due_date)) {
    return <div className="p-4 text-gray-400 text-sm">Nothing on the calendar this week.</div>
  }

  // Group events by day
  const days: { date: Date; events: CalendarEvent[] }[] = []
  for (const event of events) {
    const d = parseISO(event.start)
    const existing = days.find(g => isSameDay(g.date, d))
    if (existing) existing.events.push(event)
    else days.push({ date: d, events: [event] })
  }

  // Also collect days that only have todos (no events)
  const incompleteTodosWithDue = todos.filter(t => !t.completed && t.due_date)
  for (const todo of incompleteTodosWithDue) {
    const d = parseISO(todo.due_date!)
    if (!days.find(g => isSameDay(g.date, d))) {
      days.push({ date: d, events: [] })
    }
  }
  days.sort((a, b) => a.date.getTime() - b.date.getTime())

  return (
    <div>
      {/* Refresh button */}
      <div className="flex justify-end px-4 py-1">
        <button
          onClick={() => void handleRefresh()}
          disabled={refreshing}
          className="text-gray-300 hover:text-gray-500 transition-colors disabled:opacity-40"
          aria-label="Refresh calendar"
        >
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      {days.map(({ date, events: dayEvents }) => {
        const dayDateStr = format(date, 'yyyy-MM-dd')
        const dayTodos = incompleteTodosWithDue.filter(t => t.due_date === dayDateStr)

        return (
          <div key={date.toISOString()} className="border-b border-gray-50 last:border-0">
            <div className="px-4 py-2 bg-gray-50/60 text-xs font-semibold text-gray-500 uppercase tracking-wider">
              {format(date, 'EEEE, MMM d')}
            </div>

            {/* Calendar events */}
            {dayEvents.length > 0 && (
              <ul>
                {dayEvents.map(event => (
                  <li key={event.id} className="flex gap-3 px-4 py-2.5 items-start hover:bg-gray-50/50">
                    <div className="w-16 shrink-0 text-xs text-gray-400 pt-0.5">
                      {event.all_day ? 'all day' : format(parseISO(event.start), 'h:mm a')}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-gray-900">{event.title}</span>
                        {event.is_amion && (
                          <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700 border-0 py-0">
                            AMION
                          </Badge>
                        )}
                      </div>
                      {event.location && (
                        <div className="text-xs text-gray-400 mt-0.5 truncate">{event.location}</div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {/* Due todos for this day */}
            {dayTodos.length > 0 && (
              <ul className={dayEvents.length > 0 ? 'border-t border-dashed border-gray-100' : ''}>
                {dayTodos.map(todo => (
                  <li key={todo.id} className="flex gap-3 px-4 py-1.5 items-center hover:bg-gray-50/50">
                    <div className="w-16 shrink-0 text-xs text-gray-300">due</div>
                    <span className="text-xs text-gray-500 truncate flex-1">{todo.title}</span>
                    {todo.visibility === 'private' && (
                      <span className="text-gray-300 text-xs" title="Private">🔒</span>
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

