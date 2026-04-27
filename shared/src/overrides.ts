import type { SupabaseClient } from '@supabase/supabase-js'
import type { CalendarEvent, CalendarOverride } from './types.ts'

// ── Pure logic ────────────────────────────────────────────────────────────────

export function applyOverrides(
  events: CalendarEvent[],
  overrides: CalendarOverride[]
): CalendarEvent[] {
  if (overrides.length === 0) return events

  const overrideMap = new Map<string, CalendarOverride>()
  for (const o of overrides) {
    overrideMap.set(`${o.event_key}|${o.event_date}`, o)
  }

  const result: CalendarEvent[] = []
  for (const event of events) {
    const dateStr = event.start.slice(0, 10)
    const override = overrideMap.get(`${event.id}|${dateStr}`)

    if (!override) {
      result.push(event)
      continue
    }

    if (override.hidden) continue // filter out hidden events

    result.push({
      ...event,
      title: override.title_override ?? event.title,
      start: override.start_override ?? event.start,
      end: override.end_override ?? event.end,
      amion_kind: (override.amion_kind_override as CalendarEvent['amion_kind']) ?? event.amion_kind,
      notes: override.notes ?? undefined,
      overridden: true,
    })
  }

  return result
}

// ── Supabase IO ────────────────────────────────────────────────────────────────

export async function fetchOverrides(
  supabase: SupabaseClient,
  startDate: string,
  endDate: string,
): Promise<CalendarOverride[]> {
  const { data, error } = await supabase
    .from('calendar_overrides')
    .select('*')
    .gte('event_date', startDate)
    .lte('event_date', endDate)

  if (error) {
    console.warn('Failed to fetch overrides:', error.message)
    return []
  }
  return data as CalendarOverride[]
}

export async function upsertOverride(
  supabase: SupabaseClient,
  override: Omit<CalendarOverride, 'id'>,
): Promise<CalendarOverride> {
  const { data, error } = await supabase
    .from('calendar_overrides')
    .upsert(
      { ...override, updated_at: new Date().toISOString() },
      { onConflict: 'event_key,event_date' }
    )
    .select()
    .single()

  if (error) throw new Error(`Failed to save override: ${error.message}`)
  return data as CalendarOverride
}

export async function deleteOverride(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase
    .from('calendar_overrides')
    .delete()
    .eq('id', id)

  if (error) throw new Error(`Failed to delete override: ${error.message}`)
}
