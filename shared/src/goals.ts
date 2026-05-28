import type { SupabaseClient } from '@supabase/supabase-js'

export type GoalCategory =
  | 'meaningful_work'
  | 'family_friends'
  | 'health'
  | 'fun'
  | 'financial'

export type GoalVisibility = 'shared' | 'private'

export interface Goal {
  id: string
  text: string
  category: GoalCategory
  achieved: boolean
  visibility: GoalVisibility
  owner: 'nat' | 'caitie'
  created_by: string
  notes: string | null
  position: number
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
