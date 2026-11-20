import type { SupabaseClient } from '@supabase/supabase-js'
import { withDefaultSettings, type WorkloadSettings } from './workload.ts'

// ── Supabase IO for the workload settings row (#13) ───────────────────────────
//
// One shared row (id = 1) in `workload_settings` holds every time assumption
// the workload engine uses, as JSON. Created and seeded with neutral defaults
// by supabase/migrations/20261120090000_workload_settings.sql. Reached by the
// browser (anon key, RLS-gated); the assumptions editor (#15) writes it.

const TABLE = 'workload_settings'
const ROW_ID = 1

/**
 * The stored settings merged over the defaults. Throws when the read fails,
 * so a caller never shows numbers computed from settings it couldn't load.
 * A missing row reads as the defaults.
 */
export async function fetchWorkloadSettings(supabase: SupabaseClient): Promise<WorkloadSettings> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('settings')
    .eq('id', ROW_ID)
    .maybeSingle()

  if (error) throw new Error(`Failed to load workload settings: ${error.message}`)
  return withDefaultSettings((data as { settings?: unknown } | null)?.settings)
}

/** Replaces the stored settings; returns what was saved, merged over the defaults. */
export async function saveWorkloadSettings(
  supabase: SupabaseClient,
  settings: WorkloadSettings,
  updatedBy: string,
): Promise<WorkloadSettings> {
  const { data, error } = await supabase
    .from(TABLE)
    .upsert(
      { id: ROW_ID, settings, updated_by: updatedBy, updated_at: new Date().toISOString() },
      { onConflict: 'id' },
    )
    .select('settings')
    .single()

  if (error) throw new Error(`Failed to save workload settings: ${error.message}`)
  return withDefaultSettings((data as { settings?: unknown }).settings)
}
