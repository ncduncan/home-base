import { useEffect, useRef, useState } from 'react'
import { Check, GripVertical, Lock, MoreHorizontal } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Goal, GoalCategory, GoalStatus, GoalVisibility } from '../../lib/goals'
import GoalActionsMenu from './GoalActionsMenu'

interface Props {
  goal: Goal
  onCycleStatus: (id: string, current: GoalStatus) => void
  onUpdateText: (id: string, text: string) => void
  onChangeVisibility: (id: string, visibility: GoalVisibility) => void
  onMoveCategory: (id: string, category: GoalCategory) => void
  onDelete: (id: string) => void
}

const CYCLE_LABEL: Record<GoalStatus, string> = {
  open: 'Mark on track',
  on_track: 'Mark achieved',
  achieved: 'Mark not started',
}

/** Sage ~270° "filling arc" — the on-track / compounding state. */
function FillingArc() {
  // 14px box; circle r=5, stroke 2. Circumference ≈ 31.4; show 75% of it.
  const c = 2 * Math.PI * 5
  return (
    <svg width={11} height={11} viewBox="0 0 14 14" className="-rotate-90">
      <circle cx={7} cy={7} r={5} fill="none" stroke="var(--color-hb-grow-fade)" strokeWidth={2} />
      <circle
        cx={7}
        cy={7}
        r={5}
        fill="none"
        stroke="var(--color-hb-grow-accent)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray={`${c * 0.75} ${c}`}
      />
    </svg>
  )
}

export default function GoalRow({
  goal,
  onCycleStatus,
  onUpdateText,
  onChangeVisibility,
  onMoveCategory,
  onDelete,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(goal.text)
  const taRef = useRef<HTMLTextAreaElement | null>(null)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: goal.id, data: { category: goal.category } })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  }

  useEffect(() => { setDraft(goal.text) }, [goal.text])

  useEffect(() => {
    if (editing && taRef.current) {
      taRef.current.style.height = 'auto'
      taRef.current.style.height = `${taRef.current.scrollHeight}px`
    }
  }, [editing, draft])

  const saveText = () => {
    setEditing(false)
    const trimmed = draft.trim()
    if (!trimmed) { setDraft(goal.text); return }
    if (trimmed !== goal.text) onUpdateText(goal.id, trimmed)
  }

  const cancelEdit = () => {
    setDraft(goal.text)
    setEditing(false)
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="group/goal flex items-start gap-1.5 px-2 py-1 hover:bg-black/[.02] transition-colors rounded-sm"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        className="mt-[3px] shrink-0 cursor-grab touch-none text-hb-fg-faint hover:text-hb-fg-muted opacity-0 group-hover/goal:opacity-100 transition-opacity"
      >
        <GripVertical size={11} />
      </button>

      <button
        type="button"
        onClick={() => onCycleStatus(goal.id, goal.status)}
        aria-label={CYCLE_LABEL[goal.status]}
        className={`mt-[3px] shrink-0 h-3.5 w-3.5 rounded-[3px] border flex items-center justify-center transition-colors ${
          goal.status === 'achieved'
            ? 'bg-hb-fam-fade border-hb-fam-accent text-hb-fam-accent'
            : goal.status === 'on_track'
              ? 'bg-transparent border-transparent'
              : 'bg-transparent border-hb-border-soft hover:border-hb-fg-faint'
        }`}
      >
        {goal.status === 'achieved' && <Check size={9} strokeWidth={3.5} />}
        {goal.status === 'on_track' && <FillingArc />}
      </button>

      {editing ? (
        <textarea
          ref={taRef}
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={saveText}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveText() }
            if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
          }}
          rows={1}
          className="flex-1 min-w-0 text-[11px] bg-transparent text-hb-fg border-b border-hb-fg-faint outline-none resize-none py-0 leading-tight"
        />
      ) : (
        <span
          onClick={() => setEditing(true)}
          className={`flex-1 min-w-0 text-[11px] leading-tight cursor-text break-words ${
            goal.status === 'achieved' ? 'text-hb-fg-faint' : 'text-hb-fg'
          }`}
        >
          {goal.text}
        </span>
      )}

      {goal.visibility === 'private' && (
        <Lock
          size={9}
          className="mt-1 shrink-0 text-hb-fg-faint opacity-50"
          aria-label="Private"
        />
      )}

      <GoalActionsMenu
        goal={goal}
        onChangeVisibility={onChangeVisibility}
        onMoveCategory={onMoveCategory}
        onDelete={onDelete}
        trigger={
          <button
            type="button"
            className="mt-0.5 shrink-0 text-hb-fg-faint hover:text-hb-fg-secondary opacity-0 group-hover/goal:opacity-100 transition-opacity"
            aria-label="More actions"
          >
            <MoreHorizontal size={11} />
          </button>
        }
      />
    </li>
  )
}
