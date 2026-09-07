import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  fetchCalendarEventsDetailed,
  fetchOverrides,
  fetchGusOverrides,
  fetchHomebaseEvents,
  homebaseToCalendarEvent,
  applyOverrides,
  createAsanaClient,
  computeGusCare,
  type CalendarEvent,
  type GusResponsibility,
  type AsanaTask,
  type HomebaseEvent,
} from '@home-base/shared'
import type { Config } from './config.ts'
import type { WeekWindow } from './week-window.ts'

export type FetchedData = {
  events: CalendarEvent[]               // already overridden + homebase merged
  homebaseEvents: HomebaseEvent[]
  gusCare: GusResponsibility[]
  asanaTasks: AsanaTask[]
  /** Calendar sources that failed to read. Non-zero means gusCare is derived
   *  from an incomplete picture — safe to render, NOT safe to write from. */
  failedCalendarSources: number
}

export type DataFetchDeps = {
  config: Config
  getGoogleAccessToken: () => Promise<string>
  week: WeekWindow
}

export function createSupabaseClient(config: Config): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

export async function fetchAllData(
  supabase: SupabaseClient,
  deps: DataFetchDeps,
): Promise<FetchedData> {
  const { config, getGoogleAccessToken, week } = deps

  const asana = createAsanaClient({
    pat: config.asanaPat,
    workspaceGid: config.asanaWorkspaceGid,
  })

  // Parallel fetches — calendar, supabase rows, asana
  const [calendar, overrides, gusOverrides, homebaseEvents, asanaTasks] = await Promise.all([
    fetchCalendarEventsDetailed(getGoogleAccessToken, 0),
    fetchOverrides(supabase, week.startDate, week.endDate),
    fetchGusOverrides(supabase, week.startDate, week.endDate),
    fetchHomebaseEvents(supabase, week.startDate, week.endDate),
    asana.fetchTasks(),
  ])

  // Merge homebase events into calendar event list (same shape as the dashboard)
  const homebaseAsCalendar = homebaseEvents.map(homebaseToCalendarEvent)
  const merged = [...calendar.events, ...homebaseAsCalendar].sort((a, b) =>
    a.start.localeCompare(b.start)
  )

  const overridden = applyOverrides(merged, overrides)
  const gusCare = computeGusCare(overridden, week.dates, gusOverrides)

  return {
    events: overridden,
    homebaseEvents,
    gusCare,
    asanaTasks,
    failedCalendarSources: calendar.failedSources,
  }
}
