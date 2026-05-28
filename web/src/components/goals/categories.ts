import type { GoalCategory } from '../../lib/goals'

export const CATEGORIES: readonly { key: GoalCategory; label: string }[] = [
  { key: 'meaningful_work', label: 'Meaningful Work' },
  { key: 'family_friends',  label: 'Family & Friends' },
  { key: 'health',          label: 'Health' },
  { key: 'fun',             label: 'Fun' },
  { key: 'financial',       label: 'Financial' },
] as const

export function categoryLabel(key: GoalCategory): string {
  return CATEGORIES.find(c => c.key === key)?.label ?? key
}
