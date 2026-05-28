import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  fetchCalendarEvents,
  fetchOverrides,
  fetchHomebaseEvents,
  homebaseToCalendarEvent,
  applyOverrides,
  createAsanaClient,
  computeGusCare,
  type CalendarEvent,
  type GusResponsibility,
  type AsanaTask,
} from '@home-base/shared'
import type { Config } from './config.ts'
import type { DayWindow } from './day-window.ts'

export type FetchedData = {
  events: CalendarEvent[]            // override-merged + homebase-merged
  gusCare: GusResponsibility[]       // for the fetch window
  asanaTasks: AsanaTask[]
}

export type DataFetchDeps = {
  config: Config
  getGoogleAccessToken: () => Promise<string>
  window: DayWindow
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
  const { config, getGoogleAccessToken, window } = deps

  const asana = createAsanaClient({
    pat: config.asanaPat,
    workspaceGid: config.asanaWorkspaceGid,
  })

  // fetchCalendarEvents fetches the current Sunday→Saturday week; we filter to
  // our fetch window downstream. Today is always inside the current week, so
  // weekOffset=0 always covers it.
  const [calendarEvents, overrides, homebaseEvents, asanaTasks] = await Promise.all([
    fetchCalendarEvents(getGoogleAccessToken, 0),
    fetchOverrides(supabase, window.fetchStart, window.fetchEnd),
    fetchHomebaseEvents(supabase, window.fetchStart, window.fetchEnd),
    asana.fetchTasks(),
  ])

  const homebaseAsCalendar = homebaseEvents.map(homebaseToCalendarEvent)
  const merged = [...calendarEvents, ...homebaseAsCalendar].sort((a, b) =>
    a.start.localeCompare(b.start)
  )

  const overridden = applyOverrides(merged, overrides)
  const gusCare = computeGusCare(overridden, window.fetchDates)

  return {
    events: overridden,
    gusCare,
    asanaTasks,
  }
}
