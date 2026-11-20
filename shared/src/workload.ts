// Workload engine (#13): per-owner, per-week hours of work, home (chores,
// meals, childcare) and remaining waking time, over a window of weeks.
//
// Pure: no IO, no clock. The web wrapper (web/src/lib/workload.ts) gathers
// the inputs; every time assumption comes from `settings` (seeded with the
// neutral DEFAULT_WORKLOAD_SETTINGS, real values live in Supabase). The one
// exception is Nat's synthetic weekday work block, which is the same block the
// week view draws (work-block.ts), by decision on the ticket.

import type { AsanaTask, AsanaUser, CalendarEvent, GusResponsibility } from './types.ts'
import type { OwnerKey } from './owner-config.ts'
import { eventOwner } from './calendar/process.ts'
import { NAT_WORK_HOURS_PER_WEEKDAY } from './work-block.ts'

export type AmionKind = NonNullable<CalendarEvent['amion_kind']>

export interface TaskKeywordMinutes {
  /** Case-insensitive substring of the task name. */
  keyword: string
  minutes: number
}

export interface WorkloadSettings {
  /** Hours credited to Caitie per AMION shift, by kind. */
  shiftHours: Record<AmionKind, number>
  /** Minutes per completed Asana task with no keyword match. */
  taskDefaultMinutes: number
  /** First match wins, in list order. */
  taskKeywordMinutes: TaskKeywordMinutes[]
  dinnersPerWeek: number
  minutesPerDinner: number
  /** Nat's share of cooking, 0–100; Caitie gets the rest. */
  cookSplitNatPct: number
  mealPlanningMinutesPerWeek: number
  /** Nat's share of meal planning, 0–100; Caitie gets the rest. */
  mealPlanningSplitNatPct: number
  pickupMinutes: number
  dropoffMinutes: number
  /** Used once appointments reach the engine (#16); seeded here so the row is complete. */
  appointmentMinutes: number
  sleepHoursPerDay: number
}

/**
 * Neutral seeded defaults. No household-specific figures: real values are
 * entered in the settings row (the assumptions editor, #15).
 */
export const DEFAULT_WORKLOAD_SETTINGS: WorkloadSettings = {
  shiftHours: { day: 10, night: 16, '24hr': 24, training: 4, research: 8, backup: 0 },
  taskDefaultMinutes: 30,
  taskKeywordMinutes: [],
  dinnersPerWeek: 7,
  minutesPerDinner: 45,
  cookSplitNatPct: 50,
  mealPlanningMinutesPerWeek: 60,
  mealPlanningSplitNatPct: 50,
  pickupMinutes: 30,
  dropoffMinutes: 30,
  appointmentMinutes: 90,
  sleepHoursPerDay: 8,
}

/**
 * A stored settings value merged over the defaults, so a row saved before a
 * field existed still yields a complete object. Unknown keys are dropped.
 */
export function withDefaultSettings(stored: unknown): WorkloadSettings {
  const d = DEFAULT_WORKLOAD_SETTINGS
  const s = (stored && typeof stored === 'object' ? stored : {}) as Partial<Record<keyof WorkloadSettings, unknown>>
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
  const shift = (s.shiftHours && typeof s.shiftHours === 'object' ? s.shiftHours : {}) as Partial<Record<AmionKind, unknown>>
  const kw = Array.isArray(s.taskKeywordMinutes) ? s.taskKeywordMinutes : d.taskKeywordMinutes
  return {
    shiftHours: {
      day: num(shift.day, d.shiftHours.day),
      night: num(shift.night, d.shiftHours.night),
      '24hr': num(shift['24hr'], d.shiftHours['24hr']),
      training: num(shift.training, d.shiftHours.training),
      research: num(shift.research, d.shiftHours.research),
      backup: num(shift.backup, d.shiftHours.backup),
    },
    taskDefaultMinutes: num(s.taskDefaultMinutes, d.taskDefaultMinutes),
    taskKeywordMinutes: kw
      .filter((k): k is TaskKeywordMinutes =>
        !!k && typeof k === 'object' && typeof (k as TaskKeywordMinutes).keyword === 'string'
        && typeof (k as TaskKeywordMinutes).minutes === 'number')
      .map(k => ({ keyword: k.keyword, minutes: k.minutes })),
    dinnersPerWeek: num(s.dinnersPerWeek, d.dinnersPerWeek),
    minutesPerDinner: num(s.minutesPerDinner, d.minutesPerDinner),
    cookSplitNatPct: num(s.cookSplitNatPct, d.cookSplitNatPct),
    mealPlanningMinutesPerWeek: num(s.mealPlanningMinutesPerWeek, d.mealPlanningMinutesPerWeek),
    mealPlanningSplitNatPct: num(s.mealPlanningSplitNatPct, d.mealPlanningSplitNatPct),
    pickupMinutes: num(s.pickupMinutes, d.pickupMinutes),
    dropoffMinutes: num(s.dropoffMinutes, d.dropoffMinutes),
    appointmentMinutes: num(s.appointmentMinutes, d.appointmentMinutes),
    sleepHoursPerDay: num(s.sleepHoursPerDay, d.sleepHoursPerDay),
  }
}

export interface HomeHours {
  chores: number
  meals: number
  childcare: number
  total: number
}

export interface OwnerWeek {
  work: number
  home: HomeHours
  remaining: number
}

export interface WorkloadWeek {
  /** Sunday, 'YYYY-MM-DD'. */
  weekStart: string
  /** Days of this week counted (7, or fewer for the current week to date). */
  days: number
  partial: boolean
  byOwner: Record<OwnerKey, OwnerWeek>
}

export interface WorkloadResult {
  weeks: WorkloadWeek[]
  /** Sums over every week in `weeks`, partial ones included. */
  totals: Record<OwnerKey, OwnerWeek>
  /** First date in the window with an AMION shift, or null when there is none. */
  earliestShiftDate: string | null
}

export interface WorkloadInput {
  /** Calendar events in the window, overrides already applied. */
  events: CalendarEvent[]
  /** computeGusCare() over the window's dates, Gus overrides included. */
  gusCare: GusResponsibility[]
  /** Completed Asana tasks; only those completed inside the window count. */
  completedTasks: AsanaTask[]
  /** Asana user gid → owner. A task assigned to anyone else is excluded. */
  assigneeOwners: Record<string, OwnerKey>
  settings: WorkloadSettings
  /** Sundays, 'YYYY-MM-DD', oldest first. */
  weekStarts: string[]
  /** Last day counted, inclusive ('YYYY-MM-DD'); later days are left out. Default: every day. */
  asOf?: string
}

const OWNERS: OwnerKey[] = ['nat', 'caitie']

// ── Dates (calendar strings, no time zone) ────────────────────────────────────

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

function dayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** The local calendar date of an ISO timestamp. */
function localDate(iso: string): string {
  const t = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`
}

/**
 * The workload window ending in the week containing `today`: the `fullWeeks`
 * full weeks before it plus the current week, as Sundays, oldest first.
 */
export function workloadWeekStarts(today: string, fullWeeks = 12): string[] {
  const sunday = addDays(today, -dayOfWeek(today))
  return Array.from({ length: fullWeeks + 1 }, (_, i) => addDays(sunday, (i - fullWeeks) * 7))
}

/**
 * Asana user gid → owner, by matching each user's email against the owners'
 * personal and work emails (the week view's allowlist). The PAT owner counts
 * as `nat` even when the workspace listing omits their email.
 */
export function assigneeOwnersFromUsers(
  users: AsanaUser[],
  owners: Record<OwnerKey, { email: string; workEmail: string }>,
  patOwnerGid?: string | null,
): Record<string, OwnerKey> {
  const byEmail = new Map<string, OwnerKey>()
  for (const key of OWNERS) {
    for (const e of [owners[key].email, owners[key].workEmail]) {
      if (e) byEmail.set(e.toLowerCase(), key)
    }
  }
  const out: Record<string, OwnerKey> = {}
  for (const u of users) {
    const key = byEmail.get((u.email ?? '').toLowerCase())
    if (key) out[u.gid] = key
  }
  if (patOwnerGid) out[patOwnerGid] = 'nat'
  return out
}

// ── Engine ────────────────────────────────────────────────────────────────────

type DayHours = { work: number; chores: number; meals: number; childcare: number }

function emptyOwnerWeek(): OwnerWeek {
  return { work: 0, home: { chores: 0, meals: 0, childcare: 0, total: 0 }, remaining: 0 }
}

function addInto(a: OwnerWeek, b: OwnerWeek): void {
  a.work += b.work
  a.home.chores += b.home.chores
  a.home.meals += b.home.meals
  a.home.childcare += b.home.childcare
  a.home.total += b.home.total
  a.remaining += b.remaining
}

function taskMinutes(name: string, settings: WorkloadSettings): number {
  const lower = name.toLowerCase()
  for (const k of settings.taskKeywordMinutes) {
    if (k.keyword && lower.includes(k.keyword.toLowerCase())) return k.minutes
  }
  return settings.taskDefaultMinutes
}

const pct = (v: number) => Math.min(100, Math.max(0, v)) / 100

export function computeWorkload(input: WorkloadInput): WorkloadResult {
  const { events, gusCare, completedTasks, assigneeOwners, settings, weekStarts, asOf } = input

  // Every counted day, mapped to its week.
  const dayWeek = new Map<string, string>()
  for (const ws of weekStarts) {
    for (let i = 0; i < 7; i++) {
      const d = addDays(ws, i)
      if (asOf === undefined || d <= asOf) dayWeek.set(d, ws)
    }
  }

  const perDay = new Map<string, Record<OwnerKey, DayHours>>()
  for (const d of dayWeek.keys()) {
    perDay.set(d, {
      nat: { work: 0, chores: 0, meals: 0, childcare: 0 },
      caitie: { work: 0, chores: 0, meals: 0, childcare: 0 },
    })
  }
  const at = (date: string) => perDay.get(date)

  // Work. Nat: the synthetic weekday block. Caitie: AMION shifts by kind,
  // credited to the day the shift starts (a night shift crossing midnight
  // counts toward its start day). Vacation/leave emit no shift, so count 0.
  let earliestShiftDate: string | null = null
  for (const [d, h] of perDay) {
    const dow = dayOfWeek(d)
    if (dow >= 1 && dow <= 5) h.nat.work += NAT_WORK_HOURS_PER_WEEKDAY
  }
  for (const e of events) {
    if (!e.is_amion || !e.amion_kind || eventOwner(e) !== 'caitie') continue
    const d = e.start.slice(0, 10)
    const h = at(d)
    if (!h) continue
    h.caitie.work += settings.shiftHours[e.amion_kind] ?? 0
    if (earliestShiftDate === null || d < earliestShiftDate) earliestShiftDate = d
  }

  // Chores: completed tasks, on their completed_at date, to the assignee.
  // Unassigned splits 50/50; a non-owner assignee is excluded.
  for (const t of completedTasks) {
    if (!t.completed || !t.completed_at) continue
    const h = at(localDate(t.completed_at))
    if (!h) continue
    const hours = taskMinutes(t.name, settings) / 60
    if (t.assignee === null) {
      h.nat.chores += hours / 2
      h.caitie.chores += hours / 2
      continue
    }
    const owner = assigneeOwners[t.assignee.gid]
    if (owner) h[owner].chores += hours
  }

  // Meals: a weekly total spread evenly over the days counted.
  const cookWeekly = (settings.dinnersPerWeek * settings.minutesPerDinner) / 60
  const planWeekly = settings.mealPlanningMinutesPerWeek / 60
  const mealsPerDay: Record<OwnerKey, number> = {
    nat: (cookWeekly * pct(settings.cookSplitNatPct) + planWeekly * pct(settings.mealPlanningSplitNatPct)) / 7,
    caitie: (cookWeekly * (1 - pct(settings.cookSplitNatPct))
      + planWeekly * (1 - pct(settings.mealPlanningSplitNatPct))) / 7,
  }
  for (const h of perDay.values()) {
    h.nat.meals += mealsPerDay.nat
    h.caitie.meals += mealsPerDay.caitie
  }

  // Childcare: Gus pickups and dropoffs, overrides already applied upstream.
  for (const g of gusCare) {
    const h = at(g.date)
    if (!h) continue
    h[g.pickup].childcare += settings.pickupMinutes / 60
    h[g.dropoff].childcare += settings.dropoffMinutes / 60
  }

  // Roll up per week. Remaining: per day, 24 h − sleep − work − home, never
  // below zero, then summed.
  const waking = Math.max(0, 24 - settings.sleepHoursPerDay)
  const byWeek = new Map<string, WorkloadWeek>()
  for (const ws of weekStarts) {
    byWeek.set(ws, { weekStart: ws, days: 0, partial: false, byOwner: { nat: emptyOwnerWeek(), caitie: emptyOwnerWeek() } })
  }
  for (const [d, h] of perDay) {
    const w = byWeek.get(dayWeek.get(d)!)!
    w.days += 1
    for (const o of OWNERS) {
      const x = h[o]
      const home = x.chores + x.meals + x.childcare
      const ow = w.byOwner[o]
      ow.work += x.work
      ow.home.chores += x.chores
      ow.home.meals += x.meals
      ow.home.childcare += x.childcare
      ow.home.total += home
      ow.remaining += Math.max(0, waking - x.work - home)
    }
  }
  const weeks = weekStarts.map(ws => {
    const w = byWeek.get(ws)!
    w.partial = w.days < 7
    return w
  })
  const totals = { nat: emptyOwnerWeek(), caitie: emptyOwnerWeek() }
  for (const w of weeks) for (const o of OWNERS) addInto(totals[o], w.byOwner[o])
  return { weeks, totals, earliestShiftDate }
}
