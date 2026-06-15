import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { Goal, GoalCategory, GoalStatus, GoalVisibility } from '../../lib/goals'
import GoalRow from './GoalRow'
import AddGoalInline from './AddGoalInline'

interface Props {
  label: string
  category: GoalCategory
  goals: Goal[]
  owner: 'nat' | 'caitie'
  createdBy: string
  onCreate: (fields: Omit<Goal, 'id' | 'position'>) => Promise<void>
  onCycleStatus: (id: string, current: GoalStatus) => void
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
  onCycleStatus,
  onUpdateText,
  onChangeVisibility,
  onMoveCategory,
  onDelete,
}: Props) {
  const [adding, setAdding] = useState(false)
  const achievedCount = goals.filter(g => g.status === 'achieved').length
  // Droppable keyed by category so a goal can be dropped into an empty column.
  const { setNodeRef, isOver } = useDroppable({ id: category, data: { category } })

  return (
    <article className="flex flex-col rounded-md border border-hb-border-soft bg-hb-card overflow-hidden">
      <header className="px-2 py-2 border-b border-hb-border-rule flex items-baseline justify-between gap-2">
        <h2 className="text-[10px] font-medium uppercase tracking-[.08em] text-hb-fg-secondary">
          {label}
        </h2>
        {goals.length > 0 && (
          <span className="text-[9px] tabular-nums text-hb-fg-faint">
            {achievedCount}/{goals.length}
          </span>
        )}
      </header>

      <SortableContext items={goals.map(g => g.id)} strategy={verticalListSortingStrategy}>
        <ul
          ref={setNodeRef}
          className={`px-1 py-1 min-h-[2.25rem] transition-colors ${isOver ? 'bg-hb-grow-fade/40' : ''}`}
        >
          {goals.map(g => (
            <GoalRow
              key={g.id}
              goal={g}
              onCycleStatus={onCycleStatus}
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
      </SortableContext>

      {!adding && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] text-hb-fg-muted hover:text-hb-fg-secondary hover:bg-black/[.02] transition-colors border-t border-hb-border-rule text-left"
        >
          <Plus size={10} />
          Add goal
        </button>
      )}
    </article>
  )
}
