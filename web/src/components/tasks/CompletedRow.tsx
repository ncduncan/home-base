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
    <li className="group flex items-center gap-2 px-4 py-2 hover:bg-gray-50/50 border-b border-gray-50 last:border-0 opacity-60">
      <Checkbox checked onCheckedChange={onUncomplete} className="shrink-0" />
      <span className="flex-1 text-sm line-through text-gray-400 truncate">{task.name}</span>
      {task.completed_at && (
        <span className="text-xs text-gray-300 shrink-0">
          {formatDistanceToNow(new Date(task.completed_at), { addSuffix: true })}
        </span>
      )}
      {confirmDelete ? (
        <span className="flex items-center gap-1 shrink-0">
          <span className="text-xs text-gray-500">Delete?</span>
          <button onClick={() => { setConfirmDelete(false); onDelete() }} className="text-xs text-red-500 hover:text-red-700 font-medium">Yes</button>
          <button onClick={() => setConfirmDelete(false)} className="text-xs text-gray-400 hover:text-gray-600">No</button>
        </span>
      ) : (
        <button
          onClick={() => setConfirmDelete(true)}
          className="opacity-0 group-hover:opacity-100 text-gray-200 hover:text-red-400 text-xs transition-all shrink-0"
          aria-label="Delete"
        >✕</button>
      )}
    </li>
  )
}
