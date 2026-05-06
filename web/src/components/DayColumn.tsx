import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { wmoToIcon } from '../lib/weather'
import { eventOwner } from '../lib/calendar'
import { computeBusyBlock, type BusyBlock } from '../lib/busy-block'
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

function formatBusyBlock(block: BusyBlock): string {
  const start = format(parseISO(block.startISO), 'h:mma').toLowerCase()
  const end = format(parseISO(block.endISO), 'h:mma').toLowerCase()
  return block.crossesMidnight ? `${start} – ${end} +1` : `${start} – ${end}`
}

function isGusEvent(event: CalendarEvent): boolean {
  return event.title === 'Gus pickup' || event.title === 'Gus dropoff'
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
  onSaveOverride, onDeleteOverride, onDeleteHomebaseEvent,
  onToggleTask, onDeleteTask, onUpdateTask,
}: OwnerSectionProps) {
  const edgeClass = owner === 'nat'
    ? 'border-l-2 border-hb-nat-accent'
    : 'border-l-2 border-hb-cai-accent'
  const labelBgClass = owner === 'nat' ? 'bg-hb-nat-fade' : 'bg-hb-cai-fade'
  const headerLabel = OWNER_LABELS[owner]

  // Busy block: collapse all timed, non-Gus events into a single earliest-start
  // → latest-end block. Nat gets a synthetic 8am–5pm baseline on weekdays. Gus
  // pickup/dropoff render as discrete events below the block. All-day events
  // (e.g. AMION backup status) also render discretely.
  const blockSourceEvents = events.filter(e => !e.all_day && !isGusEvent(e))
  const block = computeBusyBlock(blockSourceEvents, owner, dayDateStr)
  const discreteEvents = events.filter(e => e.all_day || isGusEvent(e))

  const isEmpty = !block && discreteEvents.length === 0 && tasks.length === 0

  return (
    <div className={`${edgeClass} min-h-[80px]`}>
      <div className={`${labelBgClass} px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[.1em] text-hb-fg-secondary`}>
        {headerLabel}
      </div>

      {isEmpty && (
        <div className="px-3 pt-2 text-[11px] text-hb-fg-faint italic">—</div>
      )}

      {block && (
        <div className="px-3 py-1.5 text-[13px] text-hb-fg leading-tight tabular-nums">
          {formatBusyBlock(block)}
        </div>
      )}

      {discreteEvents.length > 0 && (
        <ul>
          {discreteEvents.map(event => {
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
  events, rawEvents, overrides, weather, tasks, users, userEmail,
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

  // Split events by owner (family banners are handled by WeekDashboard as spanning ribbons on lg+)
  const familyEvents = events.filter(e => e.all_day && !e.is_amion)
  const ownerEvents = events.filter(e => !(e.all_day && !e.is_amion))
  const caitieEvents = ownerEvents.filter(e => eventOwner(e) === 'caitie')
  const natEvents = ownerEvents.filter(e => eventOwner(e) === 'nat')
  // Split tasks by assignee name
  const caitieTasks = tasks.filter(t => t.assignee?.name?.toLowerCase().startsWith('cait'))
  const natTasks = tasks.filter(t => !t.assignee?.name?.toLowerCase().startsWith('cait'))

  const colClass = COL_START[dayIndex]

  return (
    <div className="contents">
      {/* Cell 1 — Day header */}
      <div className={`${colClass} lg:row-start-1 border border-hb-border-soft rounded-t-md border-b-0 ${
        isToday ? 'bg-[#e8e8e8]' : 'bg-hb-card'
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

      {/* Cell 2 — Banner row.
          Desktop (lg+): empty placeholder so the day card stays visually
          continuous; spanning ribbons (rendered by WeekDashboard) paint
          over it where they extend.
          Mobile: spanning ribbons are hidden (no multi-column to span),
          so render this day's family events inline here. When the day has
          no family events, hide the cell entirely on mobile to avoid an
          empty gap between the header and the Caitie row. */}
      <div
        className={`${colClass} lg:row-start-2 lg:bg-hb-card lg:border-x lg:border-hb-border-soft ${
          familyEvents.length === 0 ? 'hidden lg:block' : ''
        }`}
        aria-hidden={familyEvents.length === 0 ? true : undefined}
      >
        {familyEvents.length > 0 && (
          <ul className="lg:hidden flex flex-col gap-1">
            {familyEvents.map(event => (
              <li
                key={event.id}
                className="px-3 py-1.5 text-[13px] text-[#3d2f23] leading-tight border-l-2 border-hb-fam-accent bg-gradient-to-r from-hb-fam-fade via-[#fdf6ee] to-hb-fam-fade rounded-md border-y border-r border-[#f1e6da]"
              >
                {event.title}
              </li>
            ))}
          </ul>
        )}
      </div>

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
