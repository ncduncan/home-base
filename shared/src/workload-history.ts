// Gathers the inputs for the workload engine over its window (#13) and runs
// it. IO is injected, so the web wrapper only binds its clients and this stays
// testable. The window is the 12 full weeks before the current week plus the
// current week to date (workloadWeekStarts).

import type { AsanaTask, AsanaUser, CalendarEvent, CalendarOverride, GusOverride } from './types.ts'
import type { OwnerKey } from './owner-config.ts'
import { applyOverrides } from './overrides.ts'
import { computeGusCare } from './gus-care.ts'
import {
  assigneeOwnersFromUsers,
  computeWorkload,
  workloadWeekStarts,
  type WorkloadResult,
  type WorkloadSettings,
} from './workload.ts'

export interface WorkloadHistoryDeps {
  /** Events from start (inclusive) to end (exclusive), 'YYYY-MM-DD', plus failed source count. */
  fetchCalendarRange: (start: string, end: string) => Promise<{ events: CalendarEvent[]; failedSources: number }>
  /** Extra events (e.g. homebase events as CalendarEvents) in [start, end] inclusive. */
  fetchExtraEvents?: (start: string, end: string) => Promise<CalendarEvent[]>
  fetchOverrides: (start: string, end: string) => Promise<CalendarOverride[]>
  fetchGusOverrides: (start: string, end: string) => Promise<GusOverride[]>
  /** Tasks completed in [startISO, endISO). */
  fetchCompletedTasks: (startISO: string, endISO: string) => Promise<AsanaTask[]>
  fetchUsers: () => Promise<AsanaUser[]>
  /** The PAT owner, counted as `nat`; null when it can't be read. */
  fetchMe: () => Promise<AsanaUser | null>
  fetchSettings: () => Promise<WorkloadSettings>
  owners: Record<OwnerKey, { email: string; workEmail: string }>
}

export interface WorkloadHistory {
  result: WorkloadResult
  /** Calendar sources that failed to read: non-zero means the numbers undercount. */
  failedSources: number
  settings: WorkloadSettings
  /** First and last day counted, 'YYYY-MM-DD'. */
  start: string
  asOf: string
}

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** `today` is the local date, 'YYYY-MM-DD'. */
export async function loadWorkloadHistory(deps: WorkloadHistoryDeps, today: string): Promise<WorkloadHistory> {
  const weekStarts = workloadWeekStarts(today)
  const start = weekStarts[0]
  const asOf = today
  // One day earlier than the window for Gus care: a shift running overnight
  // into the first morning decides that day's dropoff.
  const fetchStart = addDays(start, -1)
  const fetchEnd = addDays(asOf, 1) // exclusive

  const [cal, extra, overrides, gusOverrides, tasks, users, me, settings] = await Promise.all([
    deps.fetchCalendarRange(fetchStart, fetchEnd),
    deps.fetchExtraEvents ? deps.fetchExtraEvents(fetchStart, asOf) : Promise.resolve([] as CalendarEvent[]),
    deps.fetchOverrides(fetchStart, asOf),
    deps.fetchGusOverrides(start, asOf),
    deps.fetchCompletedTasks(new Date(`${start}T00:00:00`).toISOString(), new Date(`${fetchEnd}T00:00:00`).toISOString()),
    deps.fetchUsers(),
    deps.fetchMe(),
    deps.fetchSettings(),
  ])

  const events = applyOverrides([...cal.events, ...extra], overrides)
  const dates: string[] = []
  for (let d = start; d <= asOf; d = addDays(d, 1)) dates.push(d)
  const gusCare = computeGusCare(events, dates, gusOverrides)
  const assigneeOwners = assigneeOwnersFromUsers(users, deps.owners, me?.gid ?? null)

  const result = computeWorkload({
    events, gusCare, completedTasks: tasks, assigneeOwners, settings, weekStarts, asOf,
  })
  return { result, failedSources: cal.failedSources, settings, start, asOf }
}
