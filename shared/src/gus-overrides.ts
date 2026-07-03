import type { SupabaseClient } from '@supabase/supabase-js'
import type { GusOverride } from './types.ts'

// ── Supabase IO for manual Gus pickup/dropoff assignment overrides ─────────────
//
// One override per (date, role). computeGusCare() consults these and lets a
// manual assignment win over the shift-derived algorithm. Mirrors the IO shape
// of overrides.ts. Reached by the browser (anon key, RLS-gated) and by the
// Sunday agent (service role).

export async function fetchGusOverrides(
  supabase: SupabaseClient,
  startDate: string,
  endDate: string,
): Promise<GusOverride[]> {
  const { data, error } = await supabase
    .from('gus_overrides')
    .select('*')
    .gte('date', startDate)
    .lte('date', endDate)

  if (error) {
    console.warn('Failed to fetch gus overrides:', error.message)
    return []
  }
  return data as GusOverride[]
}

export async function upsertGusOverride(
  supabase: SupabaseClient,
  override: { date: string; role: 'pickup' | 'dropoff'; owner: 'nat' | 'caitie'; created_by: string },
): Promise<GusOverride> {
  const { data, error } = await supabase
    .from('gus_overrides')
    .upsert(
      { ...override, updated_at: new Date().toISOString() },
      { onConflict: 'date,role' }
    )
    .select()
    .single()

  if (error) throw new Error(`Failed to save gus override: ${error.message}`)
  return data as GusOverride
}

export async function deleteGusOverride(
  supabase: SupabaseClient,
  date: string,
  role: 'pickup' | 'dropoff',
): Promise<void> {
  const { error } = await supabase
    .from('gus_overrides')
    .delete()
    .eq('date', date)
    .eq('role', role)

  if (error) throw new Error(`Failed to delete gus override: ${error.message}`)
}
