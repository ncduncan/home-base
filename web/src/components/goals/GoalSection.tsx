import { useState } from 'react'
import { Plus } from 'lucide-react'
import type { Goal, GoalCategory, GoalVisibility } from '../../lib/goals'
import GoalRow from './GoalRow'
import AddGoalInline from './AddGoalInline'

interface Props {
  label: string
  category: GoalCategory
  goals: Goal[]
  owner: 'nat' | 'caitie'
  createdBy: string
  onCreate: (fields: Omit<Goal, 'id' | 'position'>) => Promise<void>
  onToggleAchieved: (id: string, achieved: boolean) => void
  onUpdateText: (id: string, text: string) => void
  onChangeVisibility: (id: string, visibility: GoalVisibility) => void
  onMoveCategory: (id: string, category: GoalCategory) => void
  onDelete: (id: string) => void
}

export default function GoalSection({
  label,
  category,
  goals,
  owner,
  createdBy,
  onCreate,
  onToggleAchieved,
  onUpdateText,
  onChangeVisibility,
  onMoveCategory,
  onDelete,
}: Props) {
  const [adding, setAdding] = useState(false)
  const achievedCount = goals.filter(g => g.achieved).length

  return (
    <section className="space-y-1">
      <header className="flex items-baseline gap-2 mb-1">
        <h2 className="text-xs uppercase tracking-wider font-medium text-hb-fg-muted">
          {label}
        </h2>
        {goals.length > 0 && (
          <span className="text-[10px] text-hb-fg-faint tabular-nums">
            {achievedCount}/{goals.length}
          </span>
        )}
      </header>

      <ul className="space-y-0">
        {goals.map(g => (
          <GoalRow
            key={g.id}
            goal={g}
            onToggleAchieved={onToggleAchieved}
            onUpdateText={onUpdateText}
            onChangeVisibility={onChangeVisibility}
            onMoveCategory={onMoveCategory}
            onDelete={onDelete}
          />
        ))}
        {adding && (
          <AddGoalInline
            category={category}
            owner={owner}
            createdBy={createdBy}
            onCreate={onCreate}
            onClose={() => setAdding(false)}
          />
        )}
      </ul>

      {!adding && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 ml-8 mt-1 text-xs text-hb-fg-muted hover:text-hb-fg-secondary"
        >
          <Plus size={12} />
          Add goal
        </button>
      )}
    </section>
  )
}
