import { useMemo } from 'react'
import type { Goal, GoalCategory, GoalVisibility } from '../../lib/goals'
import { CATEGORIES } from './categories'
import GoalSection from './GoalSection'

interface Props {
  goals: Goal[]
  owner: 'nat' | 'caitie'
  createdBy: string
  loading: boolean
  onCreate: (fields: Omit<Goal, 'id' | 'position'>) => Promise<void>
  onToggleAchieved: (id: string, achieved: boolean) => void
  onUpdateText: (id: string, text: string) => void
  onChangeVisibility: (id: string, visibility: GoalVisibility) => void
  onMoveCategory: (id: string, category: GoalCategory) => void
  onDelete: (id: string) => void
}

export default function GoalsBoard({
  goals,
  owner,
  createdBy,
  loading,
  onCreate,
  onToggleAchieved,
  onUpdateText,
  onChangeVisibility,
  onMoveCategory,
  onDelete,
}: Props) {
  const grouped = useMemo(() => {
    const map = new Map<GoalCategory, Goal[]>()
    for (const c of CATEGORIES) map.set(c.key, [])
    for (const g of goals) {
      const bucket = map.get(g.category)
      if (bucket) bucket.push(g)
    }
    return map
  }, [goals])

  if (loading) {
    return <div className="text-xs text-hb-fg-faint">Loading goals…</div>
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 items-start">
      {CATEGORIES.map(c => (
        <GoalSection
          key={c.key}
          label={c.label}
          category={c.key}
          goals={grouped.get(c.key) ?? []}
          owner={owner}
          createdBy={createdBy}
          onCreate={onCreate}
          onToggleAchieved={onToggleAchieved}
          onUpdateText={onUpdateText}
          onChangeVisibility={onChangeVisibility}
          onMoveCategory={onMoveCategory}
          onDelete={onDelete}
        />
      ))}
    </div>
  )
}
