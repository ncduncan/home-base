import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Checkbox } from '@/components/ui/checkbox'
import type { AsanaTask } from '../../types'

interface Props {
  task: AsanaTask
  onUncomplete: () => void
  onDelete: () => void
}

export default function CompletedRow({ task, onUncomplete, onDelete }: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  return (
    <li className="group flex items-center gap-2 px-4 py-2 hover:bg-black/[.02] border-b border-hb-border-rule last:border-0 opacity-60">
      <Checkbox checked onCheckedChange={onUncomplete} className="shrink-0" />
      <span className="flex-1 text-sm line-through text-hb-fg-muted truncate">{task.name}</span>
      {task.completed_at && (
        <span className="text-xs text-hb-fg-faint shrink-0">
          {formatDistanceToNow(new Date(task.completed_at), { addSuffix: true })}
        </span>
      )}
      {confirmDelete ? (
        <span className="flex items-center gap-1 shrink-0">
          <span className="text-xs text-hb-fg-secondary">Delete?</span>
          <button onClick={() => { setConfirmDelete(false); onDelete() }} className="text-xs text-[#a14040] hover:text-[#7f3232] font-medium">Yes</button>
          <button onClick={() => setConfirmDelete(false)} className="text-xs text-hb-fg-muted hover:text-hb-fg-secondary">No</button>
        </span>
      ) : (
        <button
          onClick={() => setConfirmDelete(true)}
          className="opacity-0 group-hover:opacity-100 text-hb-fg-faint hover:text-[#a14040] text-xs transition-all shrink-0"
          aria-label="Delete"
        >✕</button>
      )}
    </li>
  )
}
