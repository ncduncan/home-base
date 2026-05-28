import { useEffect, useRef, useState } from 'react'
import { Check, Lock, MoreHorizontal } from 'lucide-react'
import type { Goal, GoalCategory, GoalVisibility } from '../../lib/goals'
import GoalActionsMenu from './GoalActionsMenu'

interface Props {
  goal: Goal
  onToggleAchieved: (id: string, achieved: boolean) => void
  onUpdateText: (id: string, text: string) => void
  onChangeVisibility: (id: string, visibility: GoalVisibility) => void
  onMoveCategory: (id: string, category: GoalCategory) => void
  onDelete: (id: string) => void
}

export default function GoalRow({
  goal,
  onToggleAchieved,
  onUpdateText,
  onChangeVisibility,
  onMoveCategory,
  onDelete,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(goal.text)
  const taRef = useRef<HTMLTextAreaElement | null>(null)

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

  const ownerEdge = goal.owner === 'nat'
    ? 'border-l-hb-nat-accent'
    : 'border-l-hb-cai-accent'

  return (
    <li className={`group/goal flex items-start gap-2 px-1.5 py-1 border-l-2 ${ownerEdge} hover:bg-black/[.02] transition-colors rounded-sm`}>
      <button
        type="button"
        onClick={() => onToggleAchieved(goal.id, !goal.achieved)}
        aria-label={goal.achieved ? 'Mark not achieved' : 'Mark achieved'}
        className={`mt-0.5 shrink-0 h-4 w-4 rounded-[4px] border flex items-center justify-center transition-colors ${
          goal.achieved
            ? 'bg-hb-fg border-hb-fg text-white'
            : 'bg-transparent border-hb-border-soft hover:border-hb-fg-faint'
        }`}
      >
        {goal.achieved && <Check size={11} strokeWidth={3} />}
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
          className="flex-1 min-w-0 text-[13px] bg-transparent text-hb-fg border-b border-hb-fg-faint outline-none resize-none py-0 leading-5"
        />
      ) : (
        <span
          onClick={() => setEditing(true)}
          className={`flex-1 min-w-0 text-[13px] leading-5 cursor-text break-words ${
            goal.achieved ? 'line-through text-hb-fg-muted' : 'text-hb-fg'
          }`}
        >
          {goal.text}
        </span>
      )}

      {goal.visibility === 'private' && (
        <Lock
          size={10}
          className="mt-1 shrink-0 text-hb-fg-faint"
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
            <MoreHorizontal size={12} />
          </button>
        }
      />
    </li>
  )
}
