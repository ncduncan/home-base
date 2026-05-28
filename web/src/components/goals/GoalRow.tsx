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

  // Auto-grow the textarea to fit content while editing
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

  const ownerDot = goal.owner === 'nat'
    ? 'bg-hb-nat-accent'
    : 'bg-hb-cai-accent'

  return (
    <li className="group flex items-start gap-3 py-1.5">
      {/* Amber circular checkbox — matches the reference image */}
      <button
        type="button"
        onClick={() => onToggleAchieved(goal.id, !goal.achieved)}
        aria-label={goal.achieved ? 'Mark not achieved' : 'Mark achieved'}
        className={`mt-0.5 shrink-0 h-5 w-5 rounded-full border flex items-center justify-center transition-colors ${
          goal.achieved
            ? 'bg-hb-cai-accent border-hb-cai-accent text-white'
            : 'bg-transparent border-hb-fg-faint hover:border-hb-fg-muted'
        }`}
      >
        {goal.achieved && <Check size={13} strokeWidth={3} />}
      </button>

      {/* Text — click to inline-edit */}
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
          className="flex-1 min-w-0 text-sm bg-transparent text-hb-fg border-b border-hb-fg-faint outline-none resize-none py-0 leading-6"
        />
      ) : (
        <span
          onClick={() => setEditing(true)}
          className={`flex-1 min-w-0 text-sm leading-6 cursor-text break-words ${
            goal.achieved ? 'font-semibold text-hb-fg' : 'text-hb-fg'
          }`}
        >
          {goal.text}
        </span>
      )}

      {/* Owner color dot */}
      <span
        title={goal.owner === 'nat' ? 'Added by Nat' : 'Added by Caitie'}
        className={`mt-2 shrink-0 h-1.5 w-1.5 rounded-full ${ownerDot}`}
      />

      {/* Private lock icon (only when private) */}
      {goal.visibility === 'private' && (
        <Lock
          size={12}
          className="mt-1.5 shrink-0 text-hb-fg-muted"
          aria-label="Private"
        />
      )}

      {/* Overflow menu */}
      <GoalActionsMenu
        goal={goal}
        onChangeVisibility={onChangeVisibility}
        onMoveCategory={onMoveCategory}
        onDelete={onDelete}
        trigger={
          <button
            type="button"
            className="mt-0.5 shrink-0 text-hb-fg-faint hover:text-hb-fg-secondary opacity-0 group-hover:opacity-100 transition-opacity p-0.5"
            aria-label="More actions"
          >
            <MoreHorizontal size={14} />
          </button>
        }
      />
    </li>
  )
}
