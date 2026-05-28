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
    <article className="flex flex-col rounded-md border border-hb-border-soft bg-hb-card overflow-hidden">
      <header className="px-3 py-2 border-b border-hb-border-rule flex items-baseline justify-between gap-2">
        <h2 className="text-[11px] font-medium uppercase tracking-[.08em] text-hb-fg-secondary">
          {label}
        </h2>
        {goals.length > 0 && (
          <span className="text-[10px] tabular-nums text-hb-fg-faint">
            {achievedCount}/{goals.length}
          </span>
        )}
      </header>

      <ul className="px-1.5 py-1">
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
          className="flex items-center gap-1 px-3 py-1.5 text-[11px] text-hb-fg-muted hover:text-hb-fg-secondary hover:bg-black/[.02] transition-colors border-t border-hb-border-rule text-left"
        >
          <Plus size={11} />
          Add goal
        </button>
      )}
    </article>
  )
}
