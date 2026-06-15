import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragOverEvent,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import type { Goal, GoalCategory, GoalStatus, GoalVisibility } from '../../lib/goals'
import { CATEGORIES } from './categories'
import GoalSection from './GoalSection'

export interface ReorderUpdate {
  id: string
  category: GoalCategory
  position: number
}

interface Props {
  goals: Goal[]
  owner: 'nat' | 'caitie'
  createdBy: string
  loading: boolean
  onCreate: (fields: Omit<Goal, 'id' | 'position'>) => Promise<void>
  onCycleStatus: (id: string, current: GoalStatus) => void
  onUpdateText: (id: string, text: string) => void
  onChangeVisibility: (id: string, visibility: GoalVisibility) => void
  onMoveCategory: (id: string, category: GoalCategory) => void
  onReorder: (updates: ReorderUpdate[]) => void
  onDelete: (id: string) => void
}

type Grouped = Record<GoalCategory, Goal[]>

function groupGoals(goals: Goal[]): Grouped {
  const out = {} as Grouped
  for (const c of CATEGORIES) out[c.key] = []
  for (const g of goals) out[g.category]?.push(g)
  return out
}

export default function GoalsBoard({
  goals,
  owner,
  createdBy,
  loading,
  onCreate,
  onCycleStatus,
  onUpdateText,
  onChangeVisibility,
  onMoveCategory,
  onReorder,
  onDelete,
}: Props) {
  // Working copy that drag mutates for live feedback; re-synced from props when idle.
  const [grouped, setGrouped] = useState<Grouped>(() => groupGoals(goals))
  const draggingRef = useRef(false)

  useEffect(() => {
    if (!draggingRef.current) setGrouped(groupGoals(goals))
  }, [goals])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const findContainer = (id: string): GoalCategory | undefined => {
    if (id in grouped) return id as GoalCategory
    return CATEGORIES.find(c => grouped[c.key].some(g => g.id === id))?.key
  }

  const handleDragStart = (_e: DragStartEvent) => {
    draggingRef.current = true
  }

  const handleDragOver = (e: DragOverEvent) => {
    const { active, over } = e
    if (!over) return
    const from = findContainer(String(active.id))
    const to = findContainer(String(over.id))
    if (!from || !to || from === to) return

    setGrouped(prev => {
      const fromItems = prev[from]
      const toItems = prev[to]
      const moving = fromItems.find(g => g.id === active.id)
      if (!moving) return prev

      // Insert before the goal hovered, or append if dropping on the column itself.
      const overIsContainer = String(over.id) === to
      const overIndex = toItems.findIndex(g => g.id === over.id)
      const insertAt = overIsContainer || overIndex === -1 ? toItems.length : overIndex

      return {
        ...prev,
        [from]: fromItems.filter(g => g.id !== active.id),
        [to]: [
          ...toItems.slice(0, insertAt),
          { ...moving, category: to },
          ...toItems.slice(insertAt),
        ],
      }
    })
  }

  const handleDragEnd = (e: DragEndEvent) => {
    draggingRef.current = false
    const { active, over } = e
    const to = over ? findContainer(String(over.id)) : undefined
    const from = findContainer(String(active.id))

    let next = grouped
    if (from && to && from === to) {
      const items = grouped[to]
      const oldIndex = items.findIndex(g => g.id === active.id)
      const newIndex = String(over!.id) === to
        ? items.length - 1
        : items.findIndex(g => g.id === over!.id)
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        next = { ...grouped, [to]: arrayMove(items, oldIndex, newIndex) }
        setGrouped(next)
      }
    }

    // Diff the final layout against the source-of-truth props and persist changes.
    const orig = new Map(goals.map(g => [g.id, g]))
    const updates: ReorderUpdate[] = []
    for (const c of CATEGORIES) {
      next[c.key].forEach((g, index) => {
        const o = orig.get(g.id)
        if (!o || o.category !== c.key || o.position !== index) {
          updates.push({ id: g.id, category: c.key, position: index })
        }
      })
    }
    if (updates.length > 0) onReorder(updates)
    else setGrouped(groupGoals(goals)) // no-op drag — snap back to props
  }

  const view = useMemo(() => grouped, [grouped])

  if (loading) {
    return <div className="text-xs text-hb-fg-faint">Loading goals…</div>
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2 items-start">
        {CATEGORIES.map(c => (
          <GoalSection
            key={c.key}
            label={c.label}
            category={c.key}
            goals={view[c.key] ?? []}
            owner={owner}
            createdBy={createdBy}
            onCreate={onCreate}
            onCycleStatus={onCycleStatus}
            onUpdateText={onUpdateText}
            onChangeVisibility={onChangeVisibility}
            onMoveCategory={onMoveCategory}
            onDelete={onDelete}
          />
        ))}
      </div>
    </DndContext>
  )
}
