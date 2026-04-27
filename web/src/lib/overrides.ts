import { supabase } from './supabase'
import {
  applyOverrides,
  fetchOverrides as sharedFetchOverrides,
  upsertOverride as sharedUpsertOverride,
  deleteOverride as sharedDeleteOverride,
} from '@home-base/shared/overrides'
import type { CalendarOverride } from '@home-base/shared/types'

export { applyOverrides }

export function fetchOverrides(startDate: string, endDate: string) {
  return sharedFetchOverrides(supabase, startDate, endDate)
}

export function upsertOverride(override: Omit<CalendarOverride, 'id'>) {
  return sharedUpsertOverride(supabase, override)
}

export function deleteOverride(id: string) {
  return sharedDeleteOverride(supabase, id)
}
