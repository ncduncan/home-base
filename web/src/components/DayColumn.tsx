import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { wmoToIcon } from '../lib/weather'
import { USER_COLORS } from '../lib/userColors'
import { eventOwner } from '../lib/calendar'
import EventDetail from './EventDetail'
import DayHeaderPanel from './DayHeaderPanel'
import AddEventForm from './AddEventForm'
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
  events: CalendarEvent[]
  rawEvents: CalendarEvent[]
  overrides: CalendarOverride[]
  weather: WeatherDay | undefined
  gusCare: GusResponsibility | undefined
  tasks: AsanaTask[]
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

function GusPill({ kind, label }: { kind: 'pickup' | 'dropoff'; label: string }) {
  return (
    <div className="px-3 py-1 flex items-center gap-1.5 text-[11px] text-gray-600 bg-blue-50/40">
      <span className="text-gray-500">{kind === 'dropoff' ? '↓' : '↑'}</span>
      Gus {kind} <span className="text-gray-400">{label}</span>
    </div>
  )
}

interface OwnerSectionProps {
  owner: 'nat' | 'caitie'
  events: CalendarEvent[]
  tasks: AsanaTask[]
  users: AsanaUser[]
  overrideMap: Map<string, CalendarOverride>
  dayDateStr: string
  expandedEventId: string | null
  setExpandedEventId: (id: string | null) => void
  userEmail: string
  hasDropoff: boolean
  hasPickup: boolean
  onSaveOverride: (override: Omit<CalendarOverride, 'id'>) => Promise<void>
  onDeleteOverride: (id: string) => Promise<void>
  onToggleTask: (gid: string, completed: boolean) => void
  onDeleteTask: (gid: string) => void
  onUpdateTask: (gid: string, patch: TaskUpdatePatch) => Promise<void>
}

function OwnerSection({
  owner, events, tasks, users, overrideMap, dayDateStr,
  expandedEventId, setExpandedEventId, userEmail,
  hasDropoff, hasPickup,
  onSaveOverride, onDeleteOverride, onToggleTask, onDeleteTask, onUpdateTask,
}: OwnerSectionProps) {
  const headerColor = owner === 'nat' ? 'text-[#305CDE]' : 'text-yellow-700'
  const headerLabel = owner === 'nat' ? 'NAT' : 'CAITIE'

  return (
    <div className="border-t border-gray-100 first:border-t-0">
      <div className={`px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider flex items-center gap-1.5 ${headerColor}`}>
        <OwnerAvatar owner={owner} size="xs" />
        {headerLabel}
      </div>

      {/* Gus pills owned by this person */}
      {hasDropoff && <GusPill kind="dropoff" label="7am" />}
      {hasPickup && <GusPill kind="pickup" label="5pm" />}

      {events.length > 0 && (
        <ul>
          {events.map(event => {
            const isExpanded = expandedEventId === event.id
            const eventOverride = overrideMap.get(`${event.id}|${dayDateStr}`) ?? null
            return (
              <li key={event.id}>
                <button
                  onClick={() => setExpandedEventId(isExpanded ? null : event.id)}
                  className={`w-full text-left px-3 py-1.5 transition-colors ${
                    isExpanded ? 'bg-gray-50' : 'hover:bg-gray-50/50'
                  }`}
                >
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

      {tasks.length > 0 && (
        <ul>
          {tasks.map(task => (
            <TaskRow
              key={task.gid}
              task={task}
              users={users}
              onToggle={onToggleTask}
              onDelete={onDeleteTask}
              onUpdate={onUpdateTask}
              compact
            />
          ))}
        </ul>
      )}

      {events.length === 0 && tasks.length === 0 && !hasDropoff && !hasPickup && (
        <div className="px-3 py-1 text-[10px] text-gray-300 italic">nothing</div>
      )}
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

  // Split events by owner
  const caitieEvents = events.filter(e => eventOwner(e) === 'caitie')
  const natEvents = events.filter(e => eventOwner(e) === 'nat')
  // Split tasks by assignee name
  const caitieTasks = tasks.filter(t => t.assignee?.name?.toLowerCase().startsWith('cait'))
  const natTasks = tasks.filter(t => !t.assignee?.name?.toLowerCase().startsWith('cait'))

  // Gus pills go to whoever's responsible
  const caitieDropoff = gusCare?.dropoff === 'caitie'
  const caitiePickup = gusCare?.pickup === 'caitie'
  const natDropoff = gusCare?.dropoff === 'nat'
  const natPickup = gusCare?.pickup === 'nat'

  return (
    <div className={`flex flex-col bg-white rounded-xl border shadow-sm overflow-hidden ${
      isToday ? 'border-[#305CDE] ring-1 ring-[#305CDE]/30' : 'border-gray-100'
    } ${isPast ? 'opacity-60' : ''}`}>
      {/* Day header (clickable to show hidden events for restore) */}
      <button
        onClick={() => setHeaderExpanded(!headerExpanded)}
        className={`w-full px-3 py-2 flex items-start justify-between gap-2 transition-colors ${
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
        {weather && (
          <div className="text-right shrink-0">
            <div className="text-base leading-none">{wmoToIcon(weather.weatherCode)}</div>
            <div className="text-[10px] text-gray-500 leading-tight mt-0.5">
              {weather.tempMin}–{weather.tempMax}°F
            </div>
          </div>
        )}
      </button>

      {headerExpanded && (
        <DayHeaderPanel
          date={dayDateStr}
          rawEvents={rawEvents}
          overrides={overrides}
          onUnhide={async (id) => { await onDeleteOverride(id) }}
          onClose={() => setHeaderExpanded(false)}
        />
      )}

      {/* Per-person sections (always shown) */}
      <div className="flex-1 min-h-0">
        <OwnerSection
          owner="caitie"
          events={caitieEvents}
          tasks={caitieTasks}
          users={users}
          overrideMap={overrideMap}
          dayDateStr={dayDateStr}
          expandedEventId={expandedEventId}
          setExpandedEventId={setExpandedEventId}
          userEmail={userEmail}
          hasDropoff={caitieDropoff}
          hasPickup={caitiePickup}
          onSaveOverride={onSaveOverride}
          onDeleteOverride={onDeleteOverride}
          onToggleTask={onToggleTask}
          onDeleteTask={onDeleteTask}
          onUpdateTask={onUpdateTask}
        />
        <OwnerSection
          owner="nat"
          events={natEvents}
          tasks={natTasks}
          users={users}
          overrideMap={overrideMap}
          dayDateStr={dayDateStr}
          expandedEventId={expandedEventId}
          setExpandedEventId={setExpandedEventId}
          userEmail={userEmail}
          hasDropoff={natDropoff}
          hasPickup={natPickup}
          onSaveOverride={onSaveOverride}
          onDeleteOverride={onDeleteOverride}
          onToggleTask={onToggleTask}
          onDeleteTask={onDeleteTask}
          onUpdateTask={onUpdateTask}
        />
      </div>

      {/* Add event + add task at bottom */}
      <div className="border-t border-gray-100">
        <AddEventForm
          date={dayDateStr}
          currentUserEmail={userEmail}
          onEventCreated={onRefreshEvents}
        />
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
