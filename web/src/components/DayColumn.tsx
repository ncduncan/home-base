import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { wmoToIcon } from '../lib/weather'
import { eventOwner } from '../lib/calendar'
import { computeRangeBlock, computeNatWorkBlock, type BusyBlock } from '../lib/busy-block'
import EventDetail from './EventDetail'
import DayHeaderPanel from './DayHeaderPanel'
import TaskRow from './tasks/TaskRow'
import type { TaskUpdatePatch } from './tasks/TaskRow'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { AlertTriangle, ChevronRight } from 'lucide-react'
import {
  isHomebaseEventId,
  homebaseIdFromCalendarEventId,
} from '../lib/homebase-events'
import type {
  AsanaTask,
  AsanaUser,
  CalendarEvent,
  CalendarOverride,
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
  tasks: AsanaTask[]
  users: AsanaUser[]
  userEmail: string
  onSaveOverride: (override: Omit<CalendarOverride, 'id'>) => Promise<void>
  onDeleteOverride: (id: string) => Promise<void>
  onDeleteHomebaseEvent: (id: string) => Promise<void>
  onToggleTask: (gid: string, completed: boolean) => void
  onDeleteTask: (gid: string) => void
  onUpdateTask: (gid: string, patch: TaskUpdatePatch) => Promise<void>
  todayDate: Date
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

function isGusEvent(event: CalendarEvent): boolean {
  return event.title === 'Gus pickup' || event.title === 'Gus dropoff'
}

// Compact lowercase time. "5p" / "5:30p" / "10:30a"
function fmtTime(iso: string): string {
  const d = parseISO(iso)
  const h = d.getHours()
  const m = d.getMinutes()
  const ampm = h >= 12 ? 'p' : 'a'
  const h12 = h % 12 || 12
  return m === 0 ? `${h12}${ampm}` : `${h12}:${m.toString().padStart(2, '0')}${ampm}`
}

// Compact range. Drops the trailing am/pm from the start when both ends share
// it on the same day (e.g. "8a–5p" stays, "9a–11a" → "9–11a"). Adds " +1" on
// crossings to next day.
function fmtRange(startIso: string, endIso: string, refDayStr: string): string {
  const s = fmtTime(startIso)
  const e = fmtTime(endIso)
  const crossesDay = endIso.slice(0, 10) !== refDayStr
  if (!crossesDay && s.slice(-1) === e.slice(-1)) {
    return `${s.slice(0, -1)}–${e}`
  }
  return `${s}–${e}${crossesDay ? ' +1' : ''}`
}

function eventTimeText(event: CalendarEvent, refDayStr: string): string {
  if (event.all_day) return 'all day'
  return fmtRange(event.start, event.end, refDayStr)
}

function blockTimeText(block: BusyBlock, refDayStr: string): string {
  return fmtRange(block.startISO, block.endISO, refDayStr)
}

function eventsOverlap(
  a: { start: string; end: string },
  b: { start: string; end: string },
): boolean {
  return a.start < b.end && b.start < a.end
}

function prevDayStr(dateStr: string): string {
  const d = parseISO(`${dateStr}T12:00:00`)
  d.setDate(d.getDate() - 1)
  return format(d, 'yyyy-MM-dd')
}

// Whether an all-day family event starts before / continues past `dayDateStr`.
// Google all-day events use exclusive end dates (end='2026-05-11' ⇒ last
// covered day is 2026-05-10). The homebase-events Supabase store mirrors this.
function familySpan(event: CalendarEvent, dayDateStr: string) {
  const startDate = event.start.slice(0, 10)
  const endDate = event.end.slice(0, 10)
  const lastDay = endDate > startDate ? prevDayStr(endDate) : startDate
  return {
    continuesPast: lastDay > dayDateStr,
    continuesFromBefore: startDate < dayDateStr,
  }
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

  // Owner-specific block + discrete-event split:
  // - Caitie: AMION shifts (+ all-day backup) and Gus events render discretely
  //   with their existing labels; only her non-AMION timed events (research,
  //   personal Google) collapse into a single earliest-latest block.
  // - Nat: a static synthetic 8a–5p M–F "Work" block; every other event he
  //   owns (incl. Gus) renders discretely with its actual title.
  const isNat = owner === 'nat'
  const block: BusyBlock | null = isNat
    ? computeNatWorkBlock(dayDateStr)
    : computeRangeBlock(
        events.filter(e => !e.is_amion && !e.all_day && !isGusEvent(e)),
        'Research',
      )
  const discreteEvents = isNat
    ? events
    : events.filter(e => e.is_amion || e.all_day || isGusEvent(e))

  type Item =
    | { kind: 'block'; block: BusyBlock; sortKey: string }
    | { kind: 'event'; event: CalendarEvent; sortKey: string }
  const items: Item[] = []
  if (block) items.push({ kind: 'block', block, sortKey: block.startISO })
  for (const e of discreteEvents) items.push({ kind: 'event', event: e, sortKey: e.start })
  items.sort((a, b) => a.sortKey.localeCompare(b.sortKey))

  return (
    <div className={`${edgeClass} flex flex-col`}>
      {items.length > 0 && (
        <ul className="py-1">
          {items.map(item => {
            if (item.kind === 'block') {
              const b = item.block
              return (
                <li
                  key={`block-${b.startISO}`}
                  className="px-2 py-0.5 flex items-baseline gap-1.5 text-[11px] leading-tight"
                >
                  <span className="text-[10px] tabular-nums text-hb-fg-muted shrink-0">
                    {blockTimeText(b, dayDateStr)}
                  </span>
                  {b.label && (
                    <span className="text-hb-fg truncate">{b.label}</span>
                  )}
                </li>
              )
            }

            const event = item.event
            const isExpanded = expandedEventId === event.id
            const eventOverride = overrideMap.get(`${event.id}|${dayDateStr}`) ?? null
            const isHomebase = isHomebaseEventId(event.id)
            const titleText = event.is_amion ? shiftLabel(event.amion_kind) : event.title
            const timeText = eventTimeText(event, dayDateStr)

            // Conflict: Nat is assigned a Gus pickup/dropoff but has another
            // real event overlapping that window. Caitie's side is checked
            // upstream by computeGusCare so we only flag Nat's column.
            const conflict = isNat && isGusEvent(event)
              && events.some(other =>
                other.id !== event.id
                && !other.all_day
                && !isGusEvent(other)
                && eventsOverlap(event, other),
              )

            const triggerButton = (
              <button
                className={`w-full flex items-baseline gap-1.5 px-2 py-0.5 text-left rounded-sm transition-colors ${
                  isExpanded ? 'bg-black/[.04]' : 'hover:bg-black/[.03]'
                }`}
              >
                {conflict && (
                  <AlertTriangle
                    aria-label="Schedule conflict"
                    className="size-3 text-red-700 shrink-0 self-center"
                  />
                )}
                <span className="text-[10px] tabular-nums text-hb-fg-muted shrink-0">
                  {timeText}
                </span>
                <span className={`text-[11px] truncate flex-1 min-w-0 ${
                  conflict ? 'text-red-700' : 'text-hb-fg'
                }`}>
                  {titleText}
                </span>
                {event.overridden && (
                  <span className="text-[9px] text-[#a07a18] shrink-0">edited</span>
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
                      className="absolute top-1/2 -translate-y-1/2 right-1 opacity-0 group-hover/event:opacity-100 text-gray-300 hover:text-red-500 transition-all text-[10px]"
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
        <ul className="mt-auto pt-1">
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
  events, rawEvents, overrides, weather, tasks, users, userEmail,
  onSaveOverride, onDeleteOverride,
  onDeleteHomebaseEvent,
  onToggleTask, onDeleteTask, onUpdateTask,
  todayDate,
}: Props) {
  const dayDateStr = format(date, 'yyyy-MM-dd')
  const [headerExpanded, setHeaderExpanded] = useState(false)
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null)

  const overrideMap = new Map<string, CalendarOverride>()
  for (const o of overrides) overrideMap.set(`${o.event_key}|${o.event_date}`, o)

  // Banner candidates: all-day, non-AMION events that overlap this day.
  // Multi-day banners get a continuation chevron on days where they extend
  // past today (carried in the row's right gutter).
  const familyEvents = events.filter(e => e.all_day && !e.is_amion)
  const ownerEvents = events.filter(e => !(e.all_day && !e.is_amion))
  const caitieEvents = ownerEvents.filter(e => eventOwner(e) === 'caitie')
  const natEvents = ownerEvents.filter(e => eventOwner(e) === 'nat')
  const caitieTasks = tasks.filter(t => t.assignee?.name?.toLowerCase().startsWith('cait'))
  const natTasks = tasks.filter(t => !t.assignee?.name?.toLowerCase().startsWith('cait'))

  const ownerProps = {
    users, overrideMap, dayDateStr,
    expandedEventId, setExpandedEventId, userEmail,
    onSaveOverride, onDeleteOverride, onDeleteHomebaseEvent,
    onToggleTask, onDeleteTask, onUpdateTask,
  }

  return (
    <article className={`flex flex-col rounded-md border bg-hb-card overflow-hidden ${
      isPast ? 'opacity-50' : ''
    } ${
      isToday ? 'border-hb-fg-muted' : 'border-hb-border-soft'
    }`}>
      {/* Day header */}
      <div className="border-b border-hb-border-rule">
        <button
          onClick={() => setHeaderExpanded(!headerExpanded)}
          className="w-full px-3 py-2 flex items-start justify-between gap-2 text-left"
        >
          <div>
            <div className={`text-[11px] font-medium uppercase tracking-[.08em] ${
              isToday ? 'text-hb-fg-secondary' : 'text-hb-fg-muted'
            }`}>
              {format(date, 'EEE')}
            </div>
            <div className="text-[15px] font-semibold text-hb-fg leading-tight tracking-tight mt-0.5">
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

      {/* Banner slot — all-day non-AMION events that touch this day. Dot prefix
          on every day they span; a small chevron on the right when the event
          extends past this day. */}
      {familyEvents.length > 0 && (
        <ul className="px-2 pt-1.5 flex flex-col gap-0.5">
          {familyEvents.map(event => {
            const isPastBanner = parseISO(event.end) <= todayDate
            const span = familySpan(event, dayDateStr)
            return (
              <li
                key={event.id}
                className={`flex items-center gap-1.5 text-[11px] leading-tight text-hb-fg ${
                  isPastBanner ? 'opacity-50' : ''
                }`}
                title={event.title}
              >
                <span
                  aria-hidden
                  className="size-1.5 rounded-full bg-hb-fam-accent shrink-0"
                />
                <span className="truncate flex-1 min-w-0">{event.title}</span>
                {span.continuesPast && (
                  <ChevronRight
                    aria-hidden
                    className="size-3 text-hb-fg-muted shrink-0"
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}

      {/* Owner split — equal-width Caitie | Nat columns */}
      <div className="grid grid-cols-2 flex-1 mt-1">
        <OwnerSection owner="caitie" events={caitieEvents} tasks={caitieTasks} {...ownerProps} />
        <OwnerSection owner="nat" events={natEvents} tasks={natTasks} {...ownerProps} />
      </div>
    </article>
  )
}
