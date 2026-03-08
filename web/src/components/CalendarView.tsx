import { useEffect, useState } from 'react'
import { format, parseISO, isSameDay } from 'date-fns'
import { fetchCalendarEvents } from '../lib/calendar'
import { Badge } from '@/components/ui/badge'
import type { CalendarEvent } from '../types'

export default function CalendarView() {
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchCalendarEvents()
      .then(setEvents)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load calendar'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="p-4 text-gray-400 text-sm">Loading calendar...</div>
  if (error) return <div className="p-4 text-red-500 text-sm">{error}</div>
  if (!events.length) {
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

  return (
    <div>
      {days.map(({ date, events: dayEvents }) => (
        <div key={date.toISOString()} className="border-b border-gray-50 last:border-0">
          <div className="px-4 py-2 bg-gray-50/60 text-xs font-semibold text-gray-500 uppercase tracking-wider">
            {format(date, 'EEEE, MMM d')}
          </div>
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
        </div>
      ))}
    </div>
  )
}
