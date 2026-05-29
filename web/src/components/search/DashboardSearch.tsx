import { useEffect, useMemo, useRef, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Search, Calendar, CheckSquare } from 'lucide-react'
import { Input } from '@/components/ui/input'
import type { AsanaTask, CalendarEvent } from '../../types'
import {
  eventDisplayTitle,
  eventSearchText,
  taskSearchText,
  weekOffsetForDate,
} from './searchText'

const MAX_PER_GROUP = 5

interface Props {
  events: CalendarEvent[]
  tasks: AsanaTask[]
  loadingMore: boolean
  onSelectEvent: (event: CalendarEvent, targetWeekOffset: number) => void
  onSelectTask: (task: AsanaTask, targetWeekOffset: number) => void
}

type Row =
  | { kind: 'event'; event: CalendarEvent }
  | { kind: 'task'; task: AsanaTask }

function eventDate(e: CalendarEvent): string {
  return e.start.slice(0, 10)
}

function eventMeta(e: CalendarEvent): string {
  const dateStr = format(parseISO(`${eventDate(e)}T12:00:00`), 'EEE MMM d')
  if (e.all_day) return `${dateStr} · all day`
  const t = parseISO(e.start)
  const h = t.getHours()
  const m = t.getMinutes()
  const ampm = h >= 12 ? 'p' : 'a'
  const h12 = h % 12 || 12
  const timeStr = m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`
  return `${dateStr} · ${timeStr}`
}

function taskMeta(t: AsanaTask): string {
  const date = t.due_on
    ? format(parseISO(`${t.due_on}T12:00:00`), 'EEE MMM d')
    : 'No due date'
  const project = t.projects?.[0]
  return project ? `${date} · ${project}` : date
}

export default function DashboardSearch({
  events,
  tasks,
  loadingMore,
  onSelectEvent,
  onSelectTask,
}: Props) {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim().toLowerCase()), 150)
    return () => clearTimeout(id)
  }, [query])

  useEffect(() => {
    if (!open) return
    const onMouseDown = (ev: MouseEvent) => {
      if (!containerRef.current?.contains(ev.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  const { eventMatches, taskMatches, eventTotal, taskTotal } = useMemo(() => {
    if (!debounced) {
      return { eventMatches: [] as CalendarEvent[], taskMatches: [] as AsanaTask[], eventTotal: 0, taskTotal: 0 }
    }
    const eMatched = events.filter(e => eventSearchText(e).includes(debounced))
    const tMatched = tasks.filter(t => taskSearchText(t).includes(debounced))
    // Sort events by start date ascending; tasks by due_on ascending (null last)
    eMatched.sort((a, b) => a.start.localeCompare(b.start))
    tMatched.sort((a, b) => {
      if (!a.due_on && !b.due_on) return a.name.localeCompare(b.name)
      if (!a.due_on) return 1
      if (!b.due_on) return -1
      return a.due_on.localeCompare(b.due_on)
    })
    return {
      eventMatches: eMatched.slice(0, MAX_PER_GROUP),
      taskMatches: tMatched.slice(0, MAX_PER_GROUP),
      eventTotal: eMatched.length,
      taskTotal: tMatched.length,
    }
  }, [debounced, events, tasks])

  const rows: Row[] = useMemo(() => [
    ...eventMatches.map(e => ({ kind: 'event' as const, event: e })),
    ...taskMatches.map(t => ({ kind: 'task' as const, task: t })),
  ], [eventMatches, taskMatches])

  // Clamp the user-controlled activeIdx into the current rows length so
  // result-set shrinkage (typing additional chars) doesn't leave it dangling.
  const clampedActiveIdx = rows.length === 0 ? 0 : Math.min(activeIdx, rows.length - 1)

  const selectRow = (row: Row) => {
    if (row.kind === 'event') {
      const offset = weekOffsetForDate(eventDate(row.event))
      onSelectEvent(row.event, offset)
    } else {
      const due = row.task.due_on ?? format(new Date(), 'yyyy-MM-dd')
      const offset = weekOffsetForDate(due)
      onSelectTask(row.task, offset)
    }
    setQuery('')
    setOpen(false)
    inputRef.current?.blur()
  }

  const onKeyDown = (ev: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) return
    if (ev.key === 'ArrowDown') {
      ev.preventDefault()
      setActiveIdx(Math.min(clampedActiveIdx + 1, rows.length - 1))
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault()
      setActiveIdx(Math.max(clampedActiveIdx - 1, 0))
    } else if (ev.key === 'Enter') {
      const row = rows[clampedActiveIdx]
      if (row) {
        ev.preventDefault()
        selectRow(row)
      }
    } else if (ev.key === 'Escape') {
      setOpen(false)
      inputRef.current?.blur()
    }
  }

  const hasResults = rows.length > 0
  const showDropdown = open && debounced.length > 0
  const noResults = showDropdown && !hasResults && !loadingMore

  return (
    <div ref={containerRef} className="relative w-full max-w-sm">
      <div className="relative">
        <Search
          size={14}
          className="absolute left-2 top-1/2 -translate-y-1/2 text-hb-fg-faint pointer-events-none"
        />
        <Input
          ref={inputRef}
          value={query}
          onChange={e => { setQuery(e.target.value); setActiveIdx(0); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search events and tasks…"
          className="pl-7 h-8 text-xs"
          aria-label="Search events and tasks"
        />
      </div>

      {showDropdown && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 max-h-[420px] overflow-y-auto rounded-md border border-hb-border-soft bg-hb-card shadow-lg">
          {eventMatches.length > 0 && (
            <ResultGroup
              label="Events"
              count={eventTotal}
              shown={eventMatches.length}
            >
              {eventMatches.map((event, i) => (
                <button
                  key={event.id}
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => selectRow({ kind: 'event', event })}
                  className={`w-full flex items-start gap-2 px-3 py-1.5 text-left ${
                    clampedActiveIdx === i ? 'bg-black/[.04]' : 'hover:bg-black/[.03]'
                  }`}
                >
                  <Calendar size={12} className="mt-0.5 shrink-0 text-hb-fg-muted" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] text-hb-fg truncate">
                      {eventDisplayTitle(event)}
                    </div>
                    <div className="text-[10px] text-hb-fg-muted tabular-nums truncate">
                      {eventMeta(event)}
                    </div>
                  </div>
                </button>
              ))}
            </ResultGroup>
          )}

          {taskMatches.length > 0 && (
            <ResultGroup
              label="Tasks"
              count={taskTotal}
              shown={taskMatches.length}
            >
              {taskMatches.map((task, i) => {
                const idx = eventMatches.length + i
                return (
                  <button
                    key={task.gid}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={() => selectRow({ kind: 'task', task })}
                    className={`w-full flex items-start gap-2 px-3 py-1.5 text-left ${
                      clampedActiveIdx === idx ? 'bg-black/[.04]' : 'hover:bg-black/[.03]'
                    }`}
                  >
                    <CheckSquare size={12} className="mt-0.5 shrink-0 text-hb-fg-muted" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] text-hb-fg truncate">{task.name}</div>
                      <div className="text-[10px] text-hb-fg-muted tabular-nums truncate">
                        {taskMeta(task)}
                      </div>
                    </div>
                  </button>
                )
              })}
            </ResultGroup>
          )}

          {loadingMore && (
            <div className="px-3 py-1.5 text-[10px] text-hb-fg-muted italic border-t border-hb-border-rule">
              Loading more results…
            </div>
          )}

          {noResults && (
            <div className="px-3 py-3 text-[12px] text-hb-fg-muted text-center">
              No matches
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ResultGroup({
  label,
  count,
  shown,
  children,
}: {
  label: string
  count: number
  shown: number
  children: React.ReactNode
}) {
  return (
    <div className="border-b border-hb-border-rule last:border-0">
      <div className="px-3 py-1 text-[9px] font-medium uppercase tracking-[.1em] text-hb-fg-faint flex items-center justify-between">
        <span>{label}</span>
        <span>{count > shown ? `${shown} of ${count}` : count}</span>
      </div>
      {children}
      {count > shown && (
        <div className="px-3 py-1 text-[10px] text-hb-fg-muted italic">
          and {count - shown} more…
        </div>
      )}
    </div>
  )
}

