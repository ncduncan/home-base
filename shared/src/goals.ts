import type { SupabaseClient } from '@supabase/supabase-js'

export type GoalCategory =
  | 'meaningful_work'
  | 'family_friends'
  | 'health'
  | 'fun'
  | 'financial'

export type GoalVisibility = 'shared' | 'private'

export type GoalStatus = 'open' | 'on_track' | 'achieved'

export interface Goal {
  id: string
  text: string
  category: GoalCategory
  status: GoalStatus
  visibility: GoalVisibility
  owner: 'nat' | 'caitie'
  created_by: string
  notes: string | null
  position: number
}

/** Click-cycle order for the goal checkbox: open → on_track → achieved → open. */
export function nextGoalStatus(s: GoalStatus): GoalStatus {
  return s === 'open' ? 'on_track' : s === 'on_track' ? 'achieved' : 'open'
}

export async function fetchGoals(supabase: SupabaseClient): Promise<Goal[]> {
  const { data, error } = await supabase
    .from('goals')
    .select('*')
    .order('category', { ascending: true })
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) {
    console.warn('Failed to fetch goals:', error.message)
    return []
  }
  return data as Goal[]
}

export async function createGoal(
  supabase: SupabaseClient,
  fields: Omit<Goal, 'id' | 'position'>,
): Promise<Goal> {
  // Append to the end of the section: position = max(position)+1 within category
  const { data: maxRow } = await supabase
    .from('goals')
    .select('position')
    .eq('category', fields.category)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextPosition = (maxRow?.position ?? -1) + 1

  const { data, error } = await supabase
    .from('goals')
    .insert({ ...fields, position: nextPosition })
    .select()
    .single()

  if (error) throw new Error(`Failed to create goal: ${error.message}`)
  return data as Goal
}

export async function updateGoal(
  supabase: SupabaseClient,
  id: string,
  fields: Partial<Omit<Goal, 'id' | 'created_by'>>,
): Promise<Goal> {
  const { data, error } = await supabase
    .from('goals')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(`Failed to update goal: ${error.message}`)
  return data as Goal
}

export async function deleteGoal(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from('goals').delete().eq('id', id)
  if (error) throw new Error(`Failed to delete goal: ${error.message}`)
}

/**
 * Persist a manual reordering. Each entry sets a goal's category + position
 * (drag-and-drop can move a goal both within and across categories). Goal
 * counts are tiny, so a parallel set of single-row updates is plenty.
 */
export async function reorderGoals(
  supabase: SupabaseClient,
  updates: { id: string; category: GoalCategory; position: number }[],
): Promise<void> {
  const results = await Promise.all(
    updates.map(u =>
      supabase
        .from('goals')
        .update({ category: u.category, position: u.position, updated_at: new Date().toISOString() })
        .eq('id', u.id),
    ),
  )
  const failed = results.find(r => r.error)
  if (failed?.error) throw new Error(`Failed to reorder goals: ${failed.error.message}`)
}
