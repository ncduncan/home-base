import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { wmoToIcon } from '../lib/weather'
import { eventOwner } from '../lib/calendar'
import EventDetail from './EventDetail'
import DayHeaderPanel from './DayHeaderPanel'
import TaskRow from './tasks/TaskRow'
import type { TaskUpdatePatch } from './tasks/TaskRow'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  isHomebaseEventId,
  homebaseIdFromCalendarEventId,
} from '../lib/homebase-events'
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
  userEmail: string
  onSaveOverride: (override: Omit<CalendarOverride, 'id'>) => Promise<void>
  onDeleteOverride: (id: string) => Promise<void>
  onDeleteHomebaseEvent: (id: string) => Promise<void>
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
  onDeleteHomebaseEvent: (id: string) => Promise<void>
  onToggleTask: (gid: string, completed: boolean) => void
  onDeleteTask: (gid: string) => void
  onUpdateTask: (gid: string, patch: TaskUpdatePatch) => Promise<void>
}

function OwnerSection({
  owner, events, tasks, users, overrideMap, dayDateStr,
  expandedEventId, setExpandedEventId, userEmail,
  hasDropoff, hasPickup,
  onSaveOverride, onDeleteOverride, onDeleteHomebaseEvent,
  onToggleTask, onDeleteTask, onUpdateTask,
}: OwnerSectionProps) {
  const headerClass = owner === 'nat'
    ? 'bg-[#305CDE] text-white'
    : 'bg-yellow-100 text-yellow-800'
  const headerLabel = owner === 'nat' ? 'NAT' : 'CAITIE'

  return (
    <div className="border-t border-gray-100 first:border-t-0">
      <div className={`px-3 py-1 text-[10px] font-semibold uppercase tracking-wider ${headerClass}`}>
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
            const isHomebase = isHomebaseEventId(event.id)
            // Homebase events have inline delete only (no override panel).
            // Everything else uses the floating popover so the details can
            // breathe outside the narrow column.
            const triggerButton = (
              <button
                className={`w-full text-left px-3 py-1.5 transition-colors ${
                  isExpanded ? 'bg-gray-50' : 'hover:bg-gray-50/50'
                }`}
              >
                <div className="text-[11px] text-gray-900 leading-tight pr-5">
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
            )

            return (
              <li key={event.id} className="group/event relative">
                {isHomebase ? (
                  <>
                    {triggerButton}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        void onDeleteHomebaseEvent(homebaseIdFromCalendarEventId(event.id))
                      }}
                      className="absolute top-1.5 right-2 opacity-0 group-hover/event:opacity-100 text-gray-300 hover:text-red-500 transition-all text-[10px]"
                      aria-label="Delete event"
                    >
                      ✕
                    </button>
                  </>
                ) : (
                  <Popover
                    open={isExpanded}
                    onOpenChange={(open) => setExpandedEventId(open ? event.id : null)}
                  >
                    <PopoverTrigger asChild>{triggerButton}</PopoverTrigger>
                    <PopoverContent
                      className="w-[360px] p-0"
                      align="start"
                      onOpenAutoFocus={(e) => e.preventDefault()}
                    >
                      <EventDetail
                        event={event}
                        override={eventOverride}
                        userEmail={userEmail}
                        onSave={onSaveOverride}
                        onDelete={onDeleteOverride}
                        onClose={() => setExpandedEventId(null)}
                      />
                    </PopoverContent>
                  </Popover>
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

    </div>
  )
}

export default function DayColumn({
  date, isToday, isPast,
  events, rawEvents, overrides, weather, gusCare, tasks, users, userEmail,
  onSaveOverride, onDeleteOverride,
  onDeleteHomebaseEvent,
  onToggleTask, onDeleteTask, onUpdateTask,
}: Props) {
  const dayDateStr = format(date, 'yyyy-MM-dd')
  const [headerExpanded, setHeaderExpanded] = useState(false)
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null)

  const overrideMap = new Map<string, CalendarOverride>()
  for (const o of overrides) overrideMap.set(`${o.event_key}|${o.event_date}`, o)

  // Family banners: all-day non-AMION events (e.g. "Susie/Dave in Boston")
  // These are not owned by either Nat or Caitie.
  const bannerEvents = events.filter(e => e.all_day && !e.is_amion)
  // Split remaining events by owner
  const ownerEvents = events.filter(e => !(e.all_day && !e.is_amion))
  const caitieEvents = ownerEvents.filter(e => eventOwner(e) === 'caitie')
  const natEvents = ownerEvents.filter(e => eventOwner(e) === 'nat')
  // Split tasks by assignee name
  const caitieTasks = tasks.filter(t => t.assignee?.name?.toLowerCase().startsWith('cait'))
  const natTasks = tasks.filter(t => !t.assignee?.name?.toLowerCase().startsWith('cait'))

  // Gus pills go to whoever's responsible
  const caitieDropoff = gusCare?.dropoff === 'caitie'
  const caitiePickup = gusCare?.pickup === 'caitie'
  const natDropoff = gusCare?.dropoff === 'nat'
  const natPickup = gusCare?.pickup === 'nat'

  return (
    <div className={`flex flex-col lg:grid lg:grid-rows-subgrid lg:row-span-4 lg:flex-none bg-white rounded-xl border shadow-sm overflow-hidden ${
      isToday ? 'border-[#305CDE] ring-1 ring-[#305CDE]/30' : 'border-gray-100'
    } ${isPast ? 'opacity-75' : ''}`}>

      {/* Row 1 — Day header */}
      <div>
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
      </div>

      {/* Row 2 — Family banners (empty when none, but row still reserved if any column has banners) */}
      <div>
        {bannerEvents.map(event => (
          <div
            key={event.id}
            className="px-3 py-1.5 bg-violet-50 text-violet-900 text-[11px] font-medium leading-tight border-b border-violet-100 last:border-b-0"
            title={event.title}
          >
            {event.title}
          </div>
        ))}
      </div>

      {/* Row 3 — CAITIE section */}
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
        onDeleteHomebaseEvent={onDeleteHomebaseEvent}
        onToggleTask={onToggleTask}
        onDeleteTask={onDeleteTask}
        onUpdateTask={onUpdateTask}
      />

      {/* Row 4 — NAT section */}
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
        onDeleteHomebaseEvent={onDeleteHomebaseEvent}
        onToggleTask={onToggleTask}
        onDeleteTask={onDeleteTask}
        onUpdateTask={onUpdateTask}
      />

    </div>
  )
}
