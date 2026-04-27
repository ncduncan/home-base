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
  dayIndex: number
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

const COL_START = ['lg:col-start-1','lg:col-start-2','lg:col-start-3','lg:col-start-4','lg:col-start-5','lg:col-start-6','lg:col-start-7'] as const

export default function DayColumn({
  dayIndex, date, isToday, isPast,
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

  const colClass = COL_START[dayIndex]

  return (
    <div className="contents">
      {/* Cell 1 — Day header */}
      <div className={`${colClass} lg:row-start-1 bg-hb-card border border-hb-border-soft rounded-t-xl border-b-0 ${
        isToday ? 'bg-hb-today-bg' : ''
      } ${isPast ? 'opacity-50' : ''}`}>
        <button
          onClick={() => setHeaderExpanded(!headerExpanded)}
          className="w-full px-3 py-2.5 flex items-start justify-between gap-2 text-left"
        >
          <div>
            <div className={`text-[11px] font-medium uppercase tracking-[.08em] ${
              isToday ? 'text-hb-fg-secondary' : 'text-hb-fg-muted'
            }`}>
              {format(date, 'EEE')}
            </div>
            <div className="text-[17px] font-semibold text-hb-fg leading-tight tracking-tight mt-0.5">
              {format(date, 'MMM d')}
              {isToday && <span className="ml-1.5 text-[10px] font-medium text-hb-fg-muted tracking-normal normal-case">· today</span>}
            </div>
          </div>
          {weather && (
            <div className="text-right shrink-0">
              <div className="text-base leading-none">{wmoToIcon(weather.weatherCode)}</div>
              <div className="text-[11px] text-hb-fg-muted leading-tight mt-0.5 tabular-nums">
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

      {/* Cell 2 — Banner row (per-day banners, kept until Task 5 replaces with spanning ribbons) */}
      <div className={`${colClass} lg:row-start-2 ${isPast ? 'opacity-50' : ''}`}>
        {bannerEvents.map(event => (
          <div
            key={event.id}
            className="px-3 py-1.5 bg-hb-fam-fade border-l-2 border-hb-fam-accent text-[12px] text-[#3d2f23] leading-tight border-y border-r border-hb-border-soft"
            title={event.title}
          >
            {event.title}
          </div>
        ))}
      </div>

      {/* Cell 3 — CAITIE row */}
      <div className={`${colClass} lg:row-start-3 bg-hb-card border-x border-hb-border-soft border-t border-hb-border-rule ${
        isPast ? 'opacity-50' : ''
      }`}>
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
      </div>

      {/* Cell 4 — NAT row */}
      <div className={`${colClass} lg:row-start-4 bg-hb-card border border-hb-border-soft border-t-0 rounded-b-xl ${
        isPast ? 'opacity-50' : ''
      }`}>
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
    </div>
  )
}
