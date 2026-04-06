import { useCallback, useState } from 'react'
import { format, parseISO, isSameDay, addDays, startOfToday, startOfDay } from 'date-fns'
import { RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Button } from '@/components/ui/button'
import { wmoToIcon } from '../lib/weather'
import { USER_COLORS } from '../lib/userColors'
import { eventOwner } from '../lib/calendar'
import EventDetail from './EventDetail'
import type { CalendarEvent, CalendarOverride, GusResponsibility, WeatherDay } from '../types'

interface Props {
  events: CalendarEvent[]
  loading: boolean
  error: string | null
  authError: boolean
  onRefresh: () => void
  weather: WeatherDay[]
  weekOffset: number
  onWeekChange: (delta: number) => void
  overrides: CalendarOverride[]
  onSaveOverride: (override: Omit<CalendarOverride, 'id'>) => Promise<void>
  onDeleteOverride: (id: string) => Promise<void>
  gusCare: GusResponsibility[]
  userEmail: string
}

function OwnerAvatar({ owner }: { owner: 'nat' | 'caitie' }) {
  return (
    <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-semibold shrink-0 ${USER_COLORS[owner].avatar}`}>
      {owner === 'nat' ? 'N' : 'C'}
    </span>
  )
}

function shiftLabel(kind: CalendarEvent['amion_kind']) {
  const labels: Record<string, string> = {
    training: 'Training',
    day:      'Day Shift',
    night:    'Night Shift',
    '24hr':   '24Hr',
    backup:   'Backup',
  }
  return (
    <span className="text-sm text-gray-900">
      {labels[kind ?? ''] ?? 'Shift'}
    </span>
  )
}

function formatAmionTime(event: CalendarEvent): string {
  if (event.all_day) return 'all day'
  const start = parseISO(event.start)
  const end = parseISO(event.end)
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

function GusCareBadge({ care }: { care: GusResponsibility }) {
  const natDropoff = care.dropoff === 'nat'
  const natPickup = care.pickup === 'nat'

  if (!natDropoff && !natPickup) return null // Caitie handles both — no badge needed

  const parts: string[] = []
  if (natDropoff) parts.push('dropoff')
  if (natPickup) parts.push('pickup')

  return (
    <div className="flex items-center gap-1.5 px-4 py-1 bg-blue-50/60">
      <span className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-semibold bg-blue-100 text-blue-700">N</span>
      <span className="text-[11px] text-blue-600">Gus {parts.join(' + ')}</span>
    </div>
  )
}

export default function CalendarView({
  events, loading, error, authError, onRefresh,
  weather, weekOffset, onWeekChange,
  overrides, onSaveOverride, onDeleteOverride,
  gusCare, userEmail,
}: Props) {
  const [refreshing, setRefreshing] = useState(false)
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null)

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    onRefresh()
    setTimeout(() => setRefreshing(false), 1200)
  }, [onRefresh])

  const weatherByDate = new Map(weather.map(w => [w.date, w]))
  const gusCareByDate = new Map(gusCare.map(g => [g.date, g]))

  // Build override lookup: "eventKey|eventDate" → override
  const overrideMap = new Map<string, CalendarOverride>()
  for (const o of overrides) {
    overrideMap.set(`${o.event_key}|${o.event_date}`, o)
  }

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
            Calendar session expired. Click to reconnect.
          </p>
          <Button variant="outline" size="sm" onClick={() => void supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
              scopes: 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events',
              redirectTo: window.location.href,
            },
          })}>
            Reconnect Calendar
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

  // Build fixed 7-day grid Sun–Sat for this week
  const todayDate = startOfDay(new Date())
  const sunday = addDays(startOfToday(), -startOfToday().getDay() + weekOffset * 7)
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(sunday, i)
    return { date, events: events.filter(e => isSameDay(parseISO(e.start), date)) }
  })

  return (
    <div>
      {header}

      {days.map(({ date, events: dayEvents }) => {
        const dayDateStr = format(date, 'yyyy-MM-dd')
        const wx = weatherByDate.get(dayDateStr)
        const gus = gusCareByDate.get(dayDateStr)
        const isPast = date < todayDate

        return (
          <div key={dayDateStr} className={`border-b border-gray-50 last:border-0 ${isPast ? 'opacity-50' : ''}`}>
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

            {gus && <GusCareBadge care={gus} />}

            {dayEvents.length > 0 && (
              <ul>
                {dayEvents.map(event => {
                  const isExpanded = expandedEventId === event.id
                  const eventOverride = overrideMap.get(`${event.id}|${dayDateStr}`) ?? null

                  return (
                    <li key={event.id}>
                      <button
                        onClick={() => setExpandedEventId(isExpanded ? null : event.id)}
                        className={`flex gap-3 px-4 py-2.5 items-start w-full text-left transition-colors ${
                          isExpanded ? 'bg-gray-50' : 'hover:bg-gray-50/50'
                        }`}
                      >
                        <div className="w-16 shrink-0 text-xs text-gray-400 pt-0.5">
                          {event.is_amion
                            ? formatAmionTime(event)
                            : event.all_day ? 'all day' : format(parseISO(event.start), 'h:mm a')}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <OwnerAvatar owner={eventOwner(event)} />
                            {event.is_amion
                              ? shiftLabel(event.amion_kind)
                              : <span className="text-sm text-gray-900">{event.title}</span>
                            }
                            {event.overridden && (
                              <span className="text-[10px] text-amber-500 font-medium">edited</span>
                            )}
                          </div>
                          {!event.is_amion && event.location && (
                            <div className="text-xs text-gray-400 mt-0.5 truncate">{event.location}</div>
                          )}
                          {event.notes && (
                            <div className="text-xs text-gray-500 mt-0.5 italic">{event.notes}</div>
                          )}
                        </div>
                      </button>

                      {isExpanded && (
                        <EventDetail
                          event={event}
                          override={eventOverride}
                          userEmail={userEmail}
                          onSave={onSaveOverride}
                          onDelete={onDeleteOverride}
                          onClose={() => setExpandedEventId(null)}
                        />
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}
