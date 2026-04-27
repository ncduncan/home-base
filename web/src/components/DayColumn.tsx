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
import { OWNER_LABELS } from '../lib/owners'
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
  bannerLaneCount: number
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
    <div className="px-3 py-1 flex items-center gap-1.5 text-[11px] text-hb-fg-secondary">
      <span className="text-hb-fg-faint">{kind === 'dropoff' ? '↓' : '↑'}</span>
      Gus {kind} <span className="text-hb-fg-muted">{label}</span>
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
  const sectionClass = owner === 'nat'
    ? 'border-l-2 border-hb-nat-accent bg-gradient-to-r from-hb-nat-fade to-hb-card to-45%'
    : 'border-l-2 border-hb-cai-accent bg-gradient-to-r from-hb-cai-fade to-hb-card to-45%'
  const headerLabel = OWNER_LABELS[owner]

  const isEmpty = events.length === 0 && tasks.length === 0 && !hasDropoff && !hasPickup

  return (
    <div className={`${sectionClass} min-h-[80px] py-2`}>
      <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[.1em] text-hb-fg-secondary">
        {headerLabel}
      </div>

      {isEmpty && (
        <div className="px-3 text-[11px] text-hb-fg-faint italic">—</div>
      )}

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
                  isExpanded ? 'bg-black/[.03]' : 'hover:bg-black/[.02]'
                }`}
              >
                <div className="text-[13px] text-hb-fg leading-tight pr-5">
                  {event.is_amion ? shiftLabel(event.amion_kind) : event.title}
                </div>
                <div className="text-[11px] text-hb-fg-muted leading-tight tabular-nums">
                  {event.is_amion
                    ? formatAmionTime(event)
                    : event.all_day ? 'all day' : format(parseISO(event.start), 'h:mm a')}
                </div>
                {event.location && !event.is_amion && (
                  <div className="text-[11px] text-hb-fg-muted truncate">{event.location}</div>
                )}
                {event.notes && (
                  <div className="text-[11px] text-hb-fg-secondary italic">{event.notes}</div>
                )}
                {event.overridden && (
                  <div className="text-[10px] text-[#a07a18] font-medium">edited</div>
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
const ROW_START = ['', 'lg:row-start-1','lg:row-start-2','lg:row-start-3','lg:row-start-4','lg:row-start-5','lg:row-start-6','lg:row-start-7'] as const

export default function DayColumn({
  dayIndex, date, isToday, isPast,
  events, rawEvents, overrides, weather, gusCare, tasks, users, userEmail,
  onSaveOverride, onDeleteOverride,
  onDeleteHomebaseEvent,
  onToggleTask, onDeleteTask, onUpdateTask,
  bannerLaneCount,
}: Props) {
  const dayDateStr = format(date, 'yyyy-MM-dd')
  const [headerExpanded, setHeaderExpanded] = useState(false)
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null)

  const overrideMap = new Map<string, CalendarOverride>()
  for (const o of overrides) overrideMap.set(`${o.event_key}|${o.event_date}`, o)

  // When bannerLaneCount > 1, multiple banner lanes push the owner rows down.
  // Banner row 2 holds the first lane; additional lanes occupy rows 3, 4, ...
  // So Caitie occupies row (2 + max(1, bannerLaneCount)) and Nat the next row.
  const caitieRow = 2 + Math.max(1, bannerLaneCount)
  const natRow = caitieRow + 1

  // Split events by owner (family banners are handled by WeekDashboard as spanning ribbons)
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
      <div className={`${colClass} lg:row-start-1 bg-hb-card border border-hb-border-soft rounded-t-md border-b-0 ${
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

      {/* Cell 2 — Banner-row placeholder. Keeps the day card visually
          continuous when the banner row has height from a ribbon in
          another column. The actual ribbon (rendered by WeekDashboard)
          paints over this placeholder where it spans. */}
      <div className={`${colClass} lg:row-start-2 bg-hb-card border-x border-hb-border-soft ${
        isPast ? 'opacity-50' : ''
      }`} aria-hidden />

      {/* Cell 3 — CAITIE row */}
      <div className={`${colClass} ${ROW_START[caitieRow]} bg-hb-card border-x border-hb-border-soft border-t border-hb-border-rule ${
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
      <div className={`${colClass} ${ROW_START[natRow]} bg-hb-card border border-hb-border-soft border-t-0 rounded-b-md ${
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
