import { supabase } from './supabase'
import {
  fetchGoals as sharedFetchGoals,
  createGoal as sharedCreateGoal,
  updateGoal as sharedUpdateGoal,
  deleteGoal as sharedDeleteGoal,
  reorderGoals as sharedReorderGoals,
  type Goal,
  type GoalCategory,
  type GoalStatus,
  type GoalVisibility,
} from '@home-base/shared/goals'

export type { Goal, GoalCategory, GoalStatus, GoalVisibility }
export { nextGoalStatus } from '@home-base/shared/goals'

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

export function reorderGoals(
  updates: { id: string; category: GoalCategory; position: number }[],
) {
  return sharedReorderGoals(supabase, updates)
}
