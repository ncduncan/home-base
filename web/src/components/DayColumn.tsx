import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { wmoToIcon } from '../lib/weather'
import { USER_COLORS } from '../lib/userColors'
import { eventOwner } from '../lib/calendar'
import EventDetail from './EventDetail'
import DayHeaderPanel from './DayHeaderPanel'
import TaskRow from './tasks/TaskRow'
import AddTaskForm from './tasks/AddTaskForm'
import type { TaskUpdatePatch } from './tasks/TaskRow'
import type {
  AsanaTask,
  AsanaUser,
  CalendarEvent,
  CalendarOverride,
  GusResponsibility,
  WeatherDay,
} from '../types'

interface Props {
  date: Date
  isToday: boolean
  isPast: boolean
  events: CalendarEvent[]            // events for THIS day (already filtered)
  rawEvents: CalendarEvent[]         // all raw events (for hidden recall)
  overrides: CalendarOverride[]      // all overrides for the week
  weather: WeatherDay | undefined
  gusCare: GusResponsibility | undefined
  tasks: AsanaTask[]                 // tasks scoped to this day (already filtered)
  users: AsanaUser[]
  selfGid: string
  userEmail: string
  onSaveOverride: (override: Omit<CalendarOverride, 'id'>) => Promise<void>
  onDeleteOverride: (id: string) => Promise<void>
  onRefreshEvents: () => void
  onAddTask: (task: AsanaTask) => void
  onToggleTask: (gid: string, completed: boolean) => void
  onDeleteTask: (gid: string) => void
  onUpdateTask: (gid: string, patch: TaskUpdatePatch) => Promise<void>
}

const SHIFT_LABELS: Record<string, string> = {
  training: 'Training',
  day:      'Day Shift',
  night:    'Night Shift',
  '24hr':   '24Hr',
  backup:   'Backup',
}

function shiftLabel(kind: CalendarEvent['amion_kind']) {
  return SHIFT_LABELS[kind ?? ''] ?? 'Shift'
}

function formatAmionTime(event: CalendarEvent): string {
  if (event.all_day) return 'all day'
  const start = parseISO(event.start)
  const end = parseISO(event.end)
  const startDate = event.start.slice(0, 10)
  const endDate = event.end.slice(0, 10)
  if (startDate !== endDate) return `${format(start, 'h a')}–${format(end, 'h a')} +1`
  return `${format(start, 'h')}–${format(end, 'h a')}`
}

function OwnerAvatar({ owner, size = 'sm' }: { owner: 'nat' | 'caitie'; size?: 'sm' | 'xs' }) {
  const cls = size === 'xs' ? 'w-4 h-4 text-[9px]' : 'w-5 h-5 text-[10px]'
  return (
    <span className={`inline-flex items-center justify-center rounded-full font-semibold shrink-0 ${cls} ${USER_COLORS[owner].avatar}`}>
      {owner === 'nat' ? 'N' : 'C'}
    </span>
  )
}

function GusPill({ kind, who, label }: { kind: 'pickup' | 'dropoff'; who: 'nat' | 'caitie'; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <OwnerAvatar owner={who} size="xs" />
      <span className="text-[11px] text-gray-600">
        Gus {kind === 'dropoff' ? '↓' : '↑'} <span className="text-gray-400">{label}</span>
      </span>
    </div>
  )
}

export default function DayColumn({
  date, isToday, isPast,
  events, rawEvents, overrides, weather, gusCare, tasks, users, selfGid, userEmail,
  onSaveOverride, onDeleteOverride, onRefreshEvents,
  onAddTask, onToggleTask, onDeleteTask, onUpdateTask,
}: Props) {
  const dayDateStr = format(date, 'yyyy-MM-dd')
  const [headerExpanded, setHeaderExpanded] = useState(false)
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null)

  const overrideMap = new Map<string, CalendarOverride>()
  for (const o of overrides) overrideMap.set(`${o.event_key}|${o.event_date}`, o)

  return (
    <div className={`flex flex-col bg-white rounded-xl border shadow-sm overflow-hidden ${
      isToday ? 'border-[#305CDE] ring-1 ring-[#305CDE]/30' : 'border-gray-100'
    } ${isPast ? 'opacity-60' : ''}`}>
      {/* Day header (clickable for add-event / restore-hidden) */}
      <button
        onClick={() => setHeaderExpanded(!headerExpanded)}
        className={`w-full px-3 py-2 flex items-center justify-between transition-colors ${
          isToday ? 'bg-[#305CDE]/10 hover:bg-[#305CDE]/20' : 'bg-gray-50/80 hover:bg-gray-100/60'
        }`}
      >
        <div className="text-left">
          <div className={`text-[10px] font-semibold uppercase tracking-wider ${
            isToday ? 'text-[#305CDE]' : 'text-gray-500'
          }`}>
            {format(date, 'EEE')}
          </div>
          <div className={`text-sm font-semibold ${isToday ? 'text-[#305CDE]' : 'text-gray-800'}`}>
            {format(date, 'MMM d')}
          </div>
        </div>
      </button>

      {headerExpanded && (
        <DayHeaderPanel
          date={dayDateStr}
          rawEvents={rawEvents}
          overrides={overrides}
          onUnhide={async (id) => { await onDeleteOverride(id) }}
          onEventCreated={onRefreshEvents}
          onClose={() => setHeaderExpanded(false)}
        />
      )}

      {/* Keynotes: weather + Gus */}
      {(weather || gusCare) && (
        <div className="px-3 py-2 border-b border-gray-50 space-y-1.5 bg-gradient-to-b from-blue-50/40 to-transparent">
          {weather && (
            <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
              <span>{wmoToIcon(weather.weatherCode)}</span>
              <span>{weather.tempMin}–{weather.tempMax}°F</span>
            </div>
          )}
          {gusCare && (
            <div className="space-y-1">
              <GusPill kind="dropoff" who={gusCare.dropoff} label="7am" />
              <GusPill kind="pickup" who={gusCare.pickup} label="5pm" />
            </div>
          )}
        </div>
      )}

      {/* Events section */}
      <div className="flex-1 min-h-0">
        <div className="px-3 pt-2 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
          Events
        </div>
        {events.length === 0 ? (
          <div className="px-3 pb-2 text-[11px] text-gray-300 italic">none</div>
        ) : (
          <ul>
            {events.map(event => {
              const isExpanded = expandedEventId === event.id
              const eventOverride = overrideMap.get(`${event.id}|${dayDateStr}`) ?? null
              return (
                <li key={event.id}>
                  <button
                    onClick={() => setExpandedEventId(isExpanded ? null : event.id)}
                    className={`w-full text-left px-3 py-1.5 flex items-start gap-1.5 transition-colors ${
                      isExpanded ? 'bg-gray-50' : 'hover:bg-gray-50/50'
                    }`}
                  >
                    <OwnerAvatar owner={eventOwner(event)} size="xs" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] text-gray-900 leading-tight">
                        {event.is_amion ? shiftLabel(event.amion_kind) : event.title}
                      </div>
                      <div className="text-[10px] text-gray-400 leading-tight">
                        {event.is_amion
                          ? formatAmionTime(event)
                          : event.all_day ? 'all day' : format(parseISO(event.start), 'h:mm a')}
                      </div>
                      {event.location && !event.is_amion && (
                        <div className="text-[10px] text-gray-400 truncate">{event.location}</div>
                      )}
                      {event.notes && (
                        <div className="text-[10px] text-gray-500 italic">{event.notes}</div>
                      )}
                      {event.overridden && (
                        <div className="text-[9px] text-amber-500 font-medium">edited</div>
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

      {/* Tasks section */}
      <div className="border-t border-gray-100">
        <div className="px-3 pt-2 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
          Tasks
        </div>
        {tasks.length === 0 ? (
          <div className="px-3 pb-1 text-[11px] text-gray-300 italic">none</div>
        ) : (
          <ul>
            {tasks.map(task => (
              <TaskRow
                key={task.gid}
                task={task}
                users={users}
                onToggle={onToggleTask}
                onDelete={onDeleteTask}
                onUpdate={onUpdateTask}
              />
            ))}
          </ul>
        )}
        <AddTaskForm
          users={users}
          selfGid={selfGid}
          defaultDueDate={dayDateStr}
          onAdd={onAddTask}
        />
      </div>
    </div>
  )
}
