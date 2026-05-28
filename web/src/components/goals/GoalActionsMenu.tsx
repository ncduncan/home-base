import { useState, type ReactElement } from 'react'
import { Lock, Eye, FolderInput, Trash2 } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import type { Goal, GoalCategory, GoalVisibility } from '../../lib/goals'
import { CATEGORIES } from './categories'

interface Props {
  goal: Goal
  onChangeVisibility: (id: string, visibility: GoalVisibility) => void
  onMoveCategory: (id: string, category: GoalCategory) => void
  onDelete: (id: string) => void
  trigger: ReactElement
}

export default function GoalActionsMenu({
  goal,
  onChangeVisibility,
  onMoveCategory,
  onDelete,
  trigger,
}: Props) {
  const [open, setOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [movingCategory, setMovingCategory] = useState(false)

  const close = () => {
    setOpen(false)
    setConfirmDelete(false)
    setMovingCategory(false)
  }

  const toggleVisibility = () => {
    onChangeVisibility(goal.id, goal.visibility === 'shared' ? 'private' : 'shared')
    close()
  }

  return (
    <Popover open={open} onOpenChange={v => { setOpen(v); if (!v) { setConfirmDelete(false); setMovingCategory(false) } }}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-52 p-1"
        onOpenAutoFocus={e => e.preventDefault()}
      >
        {movingCategory ? (
          <>
            <div className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-hb-fg-muted font-medium">
              Move to…
            </div>
            {CATEGORIES.filter(c => c.key !== goal.category).map(c => (
              <button
                key={c.key}
                onClick={() => { onMoveCategory(goal.id, c.key); close() }}
                className="w-full text-left px-2 py-1.5 text-xs text-hb-fg hover:bg-hb-today-bg rounded-md"
              >
                {c.label}
              </button>
            ))}
            <button
              onClick={() => setMovingCategory(false)}
              className="w-full text-left px-2 py-1.5 text-xs text-hb-fg-muted hover:bg-hb-today-bg rounded-md"
            >
              ← Back
            </button>
          </>
        ) : (
          <>
            <button
              onClick={toggleVisibility}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-hb-fg hover:bg-hb-today-bg rounded-md"
            >
              {goal.visibility === 'shared' ? (
                <>
                  <Lock size={12} className="text-hb-fg-muted" />
                  Make Private
                </>
              ) : (
                <>
                  <Eye size={12} className="text-hb-fg-muted" />
                  Make Shared
                </>
              )}
            </button>
            <button
              onClick={() => setMovingCategory(true)}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-hb-fg hover:bg-hb-today-bg rounded-md"
            >
              <FolderInput size={12} className="text-hb-fg-muted" />
              Move to…
            </button>
            {confirmDelete ? (
              <div className="px-2 py-1.5 text-xs flex items-center justify-between">
                <span className="text-hb-fg-secondary">Delete?</span>
                <span className="flex items-center gap-2">
                  <button
                    onClick={() => { onDelete(goal.id); close() }}
                    className="text-[#a14040] hover:text-[#7f3232] font-medium"
                  >
                    Yes
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="text-hb-fg-muted hover:text-hb-fg-secondary"
                  >
                    No
                  </button>
                </span>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-[#a14040] hover:bg-[#fcf0f0] rounded-md"
              >
                <Trash2 size={12} />
                Delete
              </button>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
