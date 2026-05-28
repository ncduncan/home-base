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

  return (
    <li className="group/goal flex items-start gap-2 px-2 py-1 hover:bg-black/[.02] transition-colors rounded-sm">
      <button
        type="button"
        onClick={() => onToggleAchieved(goal.id, !goal.achieved)}
        aria-label={goal.achieved ? 'Mark not achieved' : 'Mark achieved'}
        className={`mt-[3px] shrink-0 h-3.5 w-3.5 rounded-[3px] border flex items-center justify-center transition-colors ${
          goal.achieved
            ? 'bg-hb-fam-fade border-hb-fam-accent text-hb-fam-accent'
            : 'bg-transparent border-hb-border-soft hover:border-hb-fg-faint'
        }`}
      >
        {goal.achieved && <Check size={9} strokeWidth={3.5} />}
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
            goal.achieved ? 'text-hb-fg-faint' : 'text-hb-fg'
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
