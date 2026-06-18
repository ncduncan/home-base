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
  // Weighted score toward the goal: achieved = 1, on_track = 0.8 (in progress but
  // not finished), open = 0. The health dot is proportional: green > 2/3, amber
  // > 1/3, red at or below that.
  const done = goals.filter(g => g.status === 'achieved').length
  const onTrack = goals.filter(g => g.status === 'on_track').length
  const score = done + onTrack * 0.8
  const ratio = goals.length === 0 ? 0 : score / goals.length
  const health: 'good' | 'warn' | 'behind' | null =
    goals.length === 0 ? null : ratio > 2 / 3 ? 'good' : ratio > 1 / 3 ? 'warn' : 'behind'
  const healthDot =
    health === 'good'
      ? 'bg-hb-track-good'
      : health === 'warn'
        ? 'bg-hb-track-warn'
        : 'bg-hb-track-behind'
  // Droppable keyed by category so a goal can be dropped into an empty column.
  const { setNodeRef, isOver } = useDroppable({ id: category, data: { category } })

  return (
    <article className="flex flex-col rounded-md border border-hb-border-soft bg-hb-card overflow-hidden">
      <header className="px-2 py-2 border-b border-hb-border-rule flex items-center justify-between gap-2">
        <h2 className="text-[10px] font-medium uppercase tracking-[.08em] text-hb-fg-secondary">
          {label}
        </h2>
        {health && (
          <span
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${healthDot}`}
            role="img"
            aria-label={`${Math.round(ratio * 100)}% to goal — ${done} done, ${onTrack} on track of ${goals.length}`}
            title={`${Math.round(ratio * 100)}% to goal · ${done} done · ${onTrack} on track · ${goals.length} total`}
          />
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
