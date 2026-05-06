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

// Time-canvas constants. The canvas paints a 7am→7pm window (12 hours) onto
// 144px. Anything earlier clamps to the top, anything later clamps to the
// bottom — the "+1" in the rendered time text carries the overflow cue.
const RANGE_START_HOUR = 7
const RANGE_END_HOUR = 19
const CANVAS_HEIGHT_PX = 144
const MIN_BAR_HEIGHT_PX = 13
const PX_PER_MIN = CANVAS_HEIGHT_PX / ((RANGE_END_HOUR - RANGE_START_HOUR) * 60)

function isoToMinutesFromRangeStart(iso: string, refDayStr: string): number {
  const isoDayStr = iso.slice(0, 10)
  const dayDiff = Math.round(
    (parseISO(`${isoDayStr}T00:00:00`).getTime() - parseISO(`${refDayStr}T00:00:00`).getTime()) / 86_400_000
  )
  const t = parseISO(iso)
  return dayDiff * 1440 + t.getHours() * 60 + t.getMinutes() - RANGE_START_HOUR * 60
}

function positionInCanvas(startISO: string, endISO: string, refDayStr: string): { top: number; height: number } {
  const startMin = isoToMinutesFromRangeStart(startISO, refDayStr)
  const endMin = isoToMinutesFromRangeStart(endISO, refDayStr)
  const top = Math.max(0, Math.min(CANVAS_HEIGHT_PX - MIN_BAR_HEIGHT_PX, startMin * PX_PER_MIN))
  if (endMin <= startMin) {
    return { top, height: MIN_BAR_HEIGHT_PX }
  }
  const bottom = Math.max(MIN_BAR_HEIGHT_PX, Math.min(CANVAS_HEIGHT_PX, endMin * PX_PER_MIN))
  return { top, height: Math.max(MIN_BAR_HEIGHT_PX, bottom - top) }
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
  const barFillClass = owner === 'nat'
    ? 'bg-hb-nat-fade border-l-2 border-hb-nat-accent'
    : 'bg-hb-cai-fade border-l-2 border-hb-cai-accent'
  const headerLabel = OWNER_LABELS[owner]

  // Owner-specific block + discrete-event split:
  // - Caitie: AMION shifts (+ all-day backup) and Gus events render discretely
  //   with their existing labels; only her non-AMION timed events (research,
  //   personal Google) collapse into a single earliest-latest block.
  // - Nat: a static synthetic 8am–5pm M–F "Work" block; every other event he
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
  // Earlier items render first (DOM lower), later items render on top —
  // so a brief 1pm point will sit visually above a 9am–5pm Work block.
  items.sort((a, b) => a.sortKey.localeCompare(b.sortKey))

  const isEmpty = items.length === 0 && tasks.length === 0

  return (
    <div className={`${edgeClass} flex flex-col`}>
      <div className={`${labelBgClass} px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[.1em] text-hb-fg-secondary`}>
        {headerLabel}
      </div>

      {/* Time canvas — bars positioned by start/end. No axis drawn; vertical
          location alone communicates rough time-of-day. */}
      <div className="relative h-36 px-1">
        {items.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] text-hb-fg-faint italic">
            {isEmpty ? '—' : ''}
          </div>
        )}

        {items.map(item => {
          if (item.kind === 'block') {
            const b = item.block
            const { top, height } = positionInCanvas(b.startISO, b.endISO, dayDateStr)
            return (
              <div
                key={`block-${b.startISO}`}
                className={`absolute left-1 right-1 px-1.5 py-px rounded-[3px] overflow-hidden leading-tight ${barFillClass}`}
                style={{ top: `${top}px`, height: `${height}px` }}
              >
                {b.label && (
                  <div className="text-[11px] font-medium text-hb-fg truncate">{b.label}</div>
                )}
                <div className={`text-[10px] tabular-nums ${b.label ? 'text-hb-fg-muted' : 'text-hb-fg'}`}>
                  {formatBusyBlock(b)}
                </div>
              </div>
            )
          }

          const event = item.event
          const isExpanded = expandedEventId === event.id
          const eventOverride = overrideMap.get(`${event.id}|${dayDateStr}`) ?? null
          const isHomebase = isHomebaseEventId(event.id)
          const { top, height } = positionInCanvas(event.start, event.end, dayDateStr)

          const titleText = event.is_amion ? shiftLabel(event.amion_kind) : event.title
          const timeText = event.is_amion
            ? formatAmionTime(event)
            : event.all_day ? 'all day' : format(parseISO(event.start), 'h:mm a')

          const triggerButton = (
            <button
              className={`absolute inset-0 px-1.5 py-px text-left overflow-hidden leading-tight transition-colors ${
                isExpanded ? 'bg-black/[.04]' : 'hover:bg-black/[.03]'
              }`}
            >
              <div className="text-[11px] font-medium text-hb-fg truncate">{titleText}</div>
              <div className="text-[10px] text-hb-fg-muted tabular-nums truncate">{timeText}</div>
              {event.location && !event.is_amion && (
                <div className="text-[10px] text-hb-fg-muted truncate">{event.location}</div>
              )}
              {event.notes && (
                <div className="text-[10px] text-hb-fg-secondary italic truncate">{event.notes}</div>
              )}
              {event.overridden && (
                <div className="text-[9px] text-[#a07a18] font-medium">edited</div>
              )}
            </button>
          )

          return (
            <div
              key={event.id}
              className={`absolute left-1 right-1 group/event rounded-[3px] overflow-hidden ${barFillClass}`}
              style={{ top: `${top}px`, height: `${height}px` }}
            >
              {isHomebase ? (
                <>
                  {triggerButton}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      void onDeleteHomebaseEvent(homebaseIdFromCalendarEventId(event.id))
                    }}
                    className="absolute top-0.5 right-1 opacity-0 group-hover/event:opacity-100 text-gray-300 hover:text-red-500 transition-all text-[10px] z-10"
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
            </div>
          )
        })}
      </div>

      {tasks.length > 0 && (
        <ul className="mt-auto border-t border-dashed border-hb-border-rule">
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
  // Multi-day banners render once per day they span (no continuation hint).
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
    <article className={`flex flex-col rounded-md border border-hb-border-soft bg-hb-card overflow-hidden ${isPast ? 'opacity-50' : ''}`}>
      {/* Day header */}
      <div className={`border-b border-hb-border-rule ${isToday ? 'bg-[#e8e8e8]' : 'bg-hb-card'}`}>
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

      {/* Banner slot — all-day non-AMION events that touch this day */}
      {familyEvents.length > 0 && (
        <ul className="px-1.5 pt-1 flex flex-col gap-1">
          {familyEvents.map(event => {
            const isPastBanner = parseISO(event.end) <= todayDate
            return (
              <li
                key={event.id}
                className={`px-2 py-1 text-[11px] text-[#3d2f23] leading-tight border-l-2 border-hb-fam-accent bg-gradient-to-r from-hb-fam-fade via-[#fdf6ee] to-hb-fam-fade rounded-md border-y border-r border-[#f1e6da] ${
                  isPastBanner ? 'opacity-50' : ''
                }`}
                title={event.title}
              >
                {event.title}
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
