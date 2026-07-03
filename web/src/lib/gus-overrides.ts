import { supabase } from './supabase'
import {
  fetchGusOverrides as sharedFetchGusOverrides,
  upsertGusOverride as sharedUpsertGusOverride,
  deleteGusOverride as sharedDeleteGusOverride,
} from '@home-base/shared/gus-overrides'

export function fetchGusOverrides(startDate: string, endDate: string) {
  return sharedFetchGusOverrides(supabase, startDate, endDate)
}

export function upsertGusOverride(override: {
  date: string
  role: 'pickup' | 'dropoff'
  owner: 'nat' | 'caitie'
  created_by: string
}) {
  return sharedUpsertGusOverride(supabase, override)
}

export function deleteGusOverride(date: string, role: 'pickup' | 'dropoff') {
  return sharedDeleteGusOverride(supabase, date, role)
}
