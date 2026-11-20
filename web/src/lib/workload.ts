// Web wrapper for the workload history (#13): binds the browser's clients to
// the shared loader. All rules live in shared/ (workload.ts, workload-history.ts).

import { format } from 'date-fns'
import { supabase } from './supabase'
import { fetchCalendarEventsRangeDetailed } from './calendar'
import { fetchCompletedTasksInRange, fetchWorkspaceUsers, fetchMe } from './asana'
import { fetchOverrides } from './overrides'
import { fetchGusOverrides } from './gus-overrides'
import { fetchHomebaseEvents, homebaseToCalendarEvent } from './homebase-events'
import { OWNER_EMAILS, NAT_WORK_EMAIL, CAITIE_WORK_EMAIL } from './owners'
import { loadWorkloadHistory, type WorkloadHistory } from '@home-base/shared/workload-history'
import {
  fetchWorkloadSettings as sharedFetchWorkloadSettings,
  saveWorkloadSettings as sharedSaveWorkloadSettings,
} from '@home-base/shared/workload-settings'
import type { WorkloadSettings } from '@home-base/shared/workload'

export type { WorkloadHistory }

export function fetchWorkloadSettings() {
  return sharedFetchWorkloadSettings(supabase)
}

export function saveWorkloadSettings(settings: WorkloadSettings, updatedBy: string) {
  return sharedSaveWorkloadSettings(supabase, settings, updatedBy)
}

/** 12 full weeks before this one plus this week to date. Load only when the Workload tab opens. */
export function fetchWorkloadHistory(today: Date = new Date()): Promise<WorkloadHistory> {
  return loadWorkloadHistory({
    fetchCalendarRange: fetchCalendarEventsRangeDetailed,
    fetchExtraEvents: async (start, end) => (await fetchHomebaseEvents(start, end)).map(homebaseToCalendarEvent),
    fetchOverrides,
    fetchGusOverrides,
    fetchCompletedTasks: fetchCompletedTasksInRange,
    fetchUsers: fetchWorkspaceUsers,
    fetchMe: () => fetchMe().catch(() => null),
    fetchSettings: fetchWorkloadSettings,
    owners: {
      nat: { email: OWNER_EMAILS.nat, workEmail: NAT_WORK_EMAIL },
      caitie: { email: OWNER_EMAILS.caitie, workEmail: CAITIE_WORK_EMAIL },
    },
  }, format(today, 'yyyy-MM-dd'))
}
