import { eventOwner, type AsanaTask, type CalendarEvent, type GusResponsibility } from '@home-base/shared'
import type { WeekWindow } from './week-window.ts'

export type Owner = 'nat' | 'caitie'

export type DayEntry = {
  /** Display label e.g. "Sun, Apr 27" */
  label: string
  /** ISO date 'YYYY-MM-DD' */
  date: string
  /** Events owned by Nat that touch this date */
  natEvents: EventRow[]
  /** Events owned by Caitie that touch this date */
  caitieEvents: EventRow[]
  /** Gus pickup/dropoff for this date (weekdays only — null on weekends) */
  gus: GusResponsibility | null
  /** Whether this day is a weekend */
  isWeekend: boolean
}

export type EventRow = {
  /** Title (or AMION shift label) */
  text: string
  /** "8:00am – 5:00pm" or "All day" */
  time: string
  /** AMION shift kind, if applicable */
  amionKind?: string
}

export type TodoEntry = {
  /** Task title */
  title: string
  /** Due date YYYY-MM-DD or null */
  dueOn: string | null
  /** 'overdue' | 'today' | 'this-week' */
  bucket: 'overdue' | 'today' | 'this-week'
  /** Owner — derived from assignee name */
  owner: Owner | null
  /** Asana project (first name if multiple) */
  project: string | null
}

export type Conflict = {
  /** Short description of the conflict */
  description: string
  /** Date(s) involved */
  date: string
}

export type BriefingData = {
  /** Sunday → Saturday week window */
  week: WeekWindow
  /** Per-day breakdown */
  days: DayEntry[]
  /** Gus pickup/dropoff schedule (weekdays only) */
  gusSchedule: GusResponsibility[]
  /** Tasks due/overdue this week */
  todos: TodoEntry[]
  /** Detected scheduling conflicts / things to decide */
  conflicts: Conflict[]
}

const SHIFT_LABELS: Record<string, string> = {
  training: 'Training',
  day: 'Day Shift',
  night: 'Night Shift',
  '24hr': '24Hr',
  backup: 'Backup',
}

function dayLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`)
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function isWeekend(dateStr: string): boolean {
  const day = new Date(`${dateStr}T12:00:00`).getDay()
  return day === 0 || day === 6
}

function formatTimeRange(event: CalendarEvent): string {
  if (event.all_day) return 'All day'
  const startHour = parseInt(event.start.slice(11, 13), 10)
  const startMin = parseInt(event.start.slice(14, 16), 10)
  const endHour = parseInt(event.end.slice(11, 13), 10)
  const endMin = parseInt(event.end.slice(14, 16), 10)
  return `${formatHour(startHour, startMin)} – ${formatHour(endHour, endMin)}`
}

function formatHour(h: number, m: number): string {
  const period = h >= 12 ? 'pm' : 'am'
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return m === 0 ? `${h12}${period}` : `${h12}:${String(m).padStart(2, '0')}${period}`
}

function eventLabel(event: CalendarEvent): string {
  if (event.is_amion && event.amion_kind) {
    return SHIFT_LABELS[event.amion_kind] ?? event.amion_kind
  }
  return event.title || '(untitled)'
}

function eventDates(event: CalendarEvent): string[] {
  // Always emit the start date. Multi-day events are visualized on the start
  // day only — keeps the grid scannable.
  return [event.start.slice(0, 10)]
}

export function buildBriefingData(
  week: WeekWindow,
  events: CalendarEvent[],
  gusCare: GusResponsibility[],
  asanaTasks: AsanaTask[],
): BriefingData {
  // ── Build per-day grid ─────────────────────────────────────────────────────
  const eventsByOwnerAndDate = new Map<string, EventRow[]>()  // key = `${owner}|${date}`

  for (const event of events) {
    const owner = eventOwner(event)
    for (const date of eventDates(event)) {
      if (!week.dates.includes(date)) continue
      const key = `${owner}|${date}`
      const list = eventsByOwnerAndDate.get(key) ?? []
      list.push({
        text: eventLabel(event),
        time: formatTimeRange(event),
        amionKind: event.amion_kind,
      })
      eventsByOwnerAndDate.set(key, list)
    }
  }

  const gusByDate = new Map<string, GusResponsibility>()
  for (const g of gusCare) gusByDate.set(g.date, g)

  const days: DayEntry[] = week.dates.map(date => ({
    label: dayLabel(date),
    date,
    natEvents: eventsByOwnerAndDate.get(`nat|${date}`) ?? [],
    caitieEvents: eventsByOwnerAndDate.get(`caitie|${date}`) ?? [],
    gus: gusByDate.get(date) ?? null,
    isWeekend: isWeekend(date),
  }))

  // ── Build todos ──────────────────────────────────────────────────────────
  const todos = buildTodos(asanaTasks, week)

  // ── Detect conflicts ─────────────────────────────────────────────────────
  const conflicts = detectConflicts(days)

  return {
    week,
    days,
    gusSchedule: gusCare,
    todos,
    conflicts,
  }
}

function buildTodos(tasks: AsanaTask[], week: WeekWindow): TodoEntry[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayStr = today.toISOString().slice(0, 10)

  const result: TodoEntry[] = []
  for (const t of tasks) {
    if (t.completed) continue
    if (!t.due_on) continue

    let bucket: TodoEntry['bucket']
    if (t.due_on < todayStr) bucket = 'overdue'
    else if (t.due_on === todayStr) bucket = 'today'
    else if (t.due_on <= week.endDate) bucket = 'this-week'
    else continue

    const assigneeName = (t.assignee?.name ?? '').toLowerCase()
    let owner: Owner | null = null
    if (assigneeName.startsWith('cait')) owner = 'caitie'
    else if (assigneeName.startsWith('nat')) owner = 'nat'

    result.push({
      title: t.name,
      dueOn: t.due_on,
      bucket,
      owner,
      project: t.projects[0] ?? null,
    })
  }

  // Sort: overdue first, then today, then this-week; within bucket by due date
  const order = { overdue: 0, today: 1, 'this-week': 2 } as const
  result.sort((a, b) => {
    if (a.bucket !== b.bucket) return order[a.bucket] - order[b.bucket]
    return (a.dueOn ?? '').localeCompare(b.dueOn ?? '')
  })

  return result
}

function detectConflicts(days: DayEntry[]): Conflict[] {
  const conflicts: Conflict[] = []

  for (const day of days) {
    if (day.isWeekend) continue

    // Both have evening events (5pm or later)
    const natEvening = day.natEvents.some(hasEveningTime)
    const caitieEvening = day.caitieEvents.some(hasEveningTime)
    if (natEvening && caitieEvening) {
      conflicts.push({
        date: day.date,
        description: `${day.label}: both have evening commitments — Gus pickup may need a sitter`,
      })
    }
  }

  return conflicts
}

function hasEveningTime(row: EventRow): boolean {
  if (row.time === 'All day') return true
  // Parse start hour from "5pm" / "5:30pm" style
  const m = row.time.match(/^(\d+)(?::\d+)?(am|pm)/)
  if (!m) return false
  let h = parseInt(m[1], 10)
  if (m[2] === 'pm' && h !== 12) h += 12
  if (m[2] === 'am' && h === 12) h = 0
  return h >= 17
}
