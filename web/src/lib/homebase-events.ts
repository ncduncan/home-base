import { supabase } from './supabase'
import type { CalendarEvent } from '../types'

export interface HomebaseEvent {
  id: string
  title: string
  start_time: string       // ISO datetime, or YYYY-MM-DD for all-day
  end_time: string
  all_day: boolean
  location: string | null
  notes: string | null
  owner: 'nat' | 'caitie'
  created_by: string
}

export async function fetchHomebaseEvents(
  startDate: string,        // YYYY-MM-DD inclusive
  endDate: string,          // YYYY-MM-DD inclusive
): Promise<HomebaseEvent[]> {
  // start_time is stored as ISO; lexical compare with the date prefix works
  const { data, error } = await supabase
    .from('homebase_events')
    .select('*')
    .gte('start_time', startDate)
    .lt('start_time', `${endDate}T99`) // any time on endDate matches
    .order('start_time', { ascending: true })

  if (error) {
    console.warn('Failed to fetch homebase events:', error.message)
    return []
  }
  return data as HomebaseEvent[]
}

export async function createHomebaseEvent(
  fields: Omit<HomebaseEvent, 'id'>,
): Promise<HomebaseEvent> {
  const { data, error } = await supabase
    .from('homebase_events')
    .insert(fields)
    .select()
    .single()
  if (error) throw new Error(`Failed to create event: ${error.message}`)
  return data as HomebaseEvent
}

export async function updateHomebaseEvent(
  id: string,
  fields: Partial<Omit<HomebaseEvent, 'id' | 'created_by'>>,
): Promise<HomebaseEvent> {
  const { data, error } = await supabase
    .from('homebase_events')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(`Failed to update event: ${error.message}`)
  return data as HomebaseEvent
}

export async function deleteHomebaseEvent(id: string): Promise<void> {
  const { error } = await supabase
    .from('homebase_events')
    .delete()
    .eq('id', id)
  if (error) throw new Error(`Failed to delete event: ${error.message}`)
}

const HOMEBASE_PREFIX = 'hb-'

/** Convert a HomebaseEvent into the CalendarEvent shape used by the UI. */
export function homebaseToCalendarEvent(he: HomebaseEvent): CalendarEvent {
  return {
    id: `${HOMEBASE_PREFIX}${he.id}`,
    title: he.title,
    start: he.all_day ? `${he.start_time.slice(0, 10)}T00:00:00` : he.start_time,
    end: he.all_day ? `${he.end_time.slice(0, 10)}T00:00:00` : he.end_time,
    location: he.location,
    all_day: he.all_day,
    calendar_name: 'Home-Base',
    is_amion: false,
    homebase_owner: he.owner,
    notes: he.notes ?? undefined,
  }
}

export function isHomebaseEventId(id: string): boolean {
  return id.startsWith(HOMEBASE_PREFIX)
}

export function homebaseIdFromCalendarEventId(id: string): string {
  return id.slice(HOMEBASE_PREFIX.length)
}
