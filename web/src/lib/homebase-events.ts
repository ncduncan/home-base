import { supabase } from './supabase'
import {
  fetchHomebaseEvents as sharedFetchHomebaseEvents,
  createHomebaseEvent as sharedCreateHomebaseEvent,
  updateHomebaseEvent as sharedUpdateHomebaseEvent,
  deleteHomebaseEvent as sharedDeleteHomebaseEvent,
  homebaseToCalendarEvent,
  isHomebaseEventId,
  homebaseIdFromCalendarEventId,
  type HomebaseEvent,
} from '@home-base/shared/homebase-events'

export type { HomebaseEvent }
export { homebaseToCalendarEvent, isHomebaseEventId, homebaseIdFromCalendarEventId }

export function fetchHomebaseEvents(startDate: string, endDate: string) {
  return sharedFetchHomebaseEvents(supabase, startDate, endDate)
}

export function createHomebaseEvent(fields: Omit<HomebaseEvent, 'id'>) {
  return sharedCreateHomebaseEvent(supabase, fields)
}

export function updateHomebaseEvent(
  id: string,
  fields: Partial<Omit<HomebaseEvent, 'id' | 'created_by'>>,
) {
  return sharedUpdateHomebaseEvent(supabase, id, fields)
}

export function deleteHomebaseEvent(id: string) {
  return sharedDeleteHomebaseEvent(supabase, id)
}
