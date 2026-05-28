import { supabase } from './supabase'
import {
  fetchGoals as sharedFetchGoals,
  createGoal as sharedCreateGoal,
  updateGoal as sharedUpdateGoal,
  deleteGoal as sharedDeleteGoal,
  type Goal,
  type GoalCategory,
  type GoalVisibility,
} from '@home-base/shared/goals'

export type { Goal, GoalCategory, GoalVisibility }

export function fetchGoals() {
  return sharedFetchGoals(supabase)
}

export function createGoal(fields: Omit<Goal, 'id' | 'position'>) {
  return sharedCreateGoal(supabase, fields)
}

export function updateGoal(
  id: string,
  fields: Partial<Omit<Goal, 'id' | 'created_by'>>,
) {
  return sharedUpdateGoal(supabase, id, fields)
}

export function deleteGoal(id: string) {
  return sharedDeleteGoal(supabase, id)
}
