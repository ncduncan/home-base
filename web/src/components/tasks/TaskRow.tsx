import { useEffect, useState } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import type { AsanaTask, AsanaUser } from '../../types'
import AssigneeButton from './AssigneeButton'
import DueDateChip from './DueDateChip'

export type TaskUpdatePatch = Partial<Pick<AsanaTask, 'name' | 'notes' | 'due_on'> & { assignee_gid: string | null }>

interface Props {
  task: AsanaTask
  users: AsanaUser[]
  onToggle: (gid: string, completed: boolean) => void
  onDelete: (gid: string) => void
  onUpdate: (gid: string, patch: TaskUpdatePatch) => Promise<void>
  /** When true, hide assignee + date chip in the row (but keep in expanded panel) */
  compact?: boolean
}

export default function TaskRow({ task, users, onToggle, onDelete, onUpdate, compact = false }: Props) {
  const [nameEditing, setNameEditing] = useState(false)
  const [nameVal, setNameVal] = useState(task.name)
  const [expanded, setExpanded] = useState(false)
  const [notesVal, setNotesVal] = useState(task.notes ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => { setNameVal(task.name) }, [task.name])
  useEffect(() => { setNotesVal(task.notes ?? '') }, [task.notes])

  const saveName = async () => {
    const trimmed = nameVal.trim()
    setNameEditing(false)
    if (!trimmed) { setNameVal(task.name); return }
    if (trimmed !== task.name) await onUpdate(task.gid, { name: trimmed })
  }

  const saveNotes = async () => {
    const val = notesVal.trim()
    if (val !== (task.notes ?? '').trim()) await onUpdate(task.gid, { notes: val || null })
  }

  return (
    <li className="group border-b border-gray-50 last:border-0">
      <div className="flex items-center gap-1.5 px-2 py-1.5 hover:bg-gray-50/50">
        <Checkbox
          checked={task.completed}
          onCheckedChange={checked => onToggle(task.gid, checked as boolean)}
          className="shrink-0 h-3.5 w-3.5"
        />

        {nameEditing && !task.completed ? (
          <input
            autoFocus
            value={nameVal}
            onChange={e => setNameVal(e.target.value)}
            onBlur={() => void saveName()}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); void saveName() }
              if (e.key === 'Escape') { setNameVal(task.name); setNameEditing(false) }
            }}
            className="flex-1 min-w-0 text-xs bg-transparent border-b border-blue-400 outline-none py-0.5"
          />
        ) : (
          <span
            onClick={() => !task.completed && setNameEditing(true)}
            className={`flex-1 min-w-0 text-xs ${
              task.completed
                ? 'line-through text-gray-400'
                : 'text-gray-900 cursor-pointer hover:text-blue-600'
            }`}
          >
            {task.name}
          </span>
        )}

        {!compact && (
          <>
            <AssigneeButton
              assignee={task.assignee}
              users={users}
              onSave={gid => void onUpdate(task.gid, { assignee_gid: gid })}
            />

            <DueDateChip
              due_on={task.due_on}
              completed={task.completed}
              onSave={val => void onUpdate(task.gid, { due_on: val })}
            />
          </>
        )}

        <button
          onClick={() => setExpanded(!expanded)}
          title={expanded ? 'Hide details' : 'Show details'}
          className="text-[10px] text-gray-400 hover:text-gray-700 transition-colors shrink-0 opacity-50 group-hover:opacity-100"
        >
          {expanded ? '▾' : '▸'}
        </button>

        {confirmDelete ? (
          <span className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => { setConfirmDelete(false); onDelete(task.gid) }}
              className="text-[10px] text-red-500 hover:text-red-700 font-medium"
            >Yes</button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="text-[10px] text-gray-400 hover:text-gray-600"
            >No</button>
          </span>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="opacity-0 group-hover:opacity-100 text-gray-200 hover:text-red-400 text-[10px] transition-all shrink-0"
            aria-label="Delete"
          >✕</button>
        )}
      </div>

      {expanded && (
        <div className="px-2 pb-2 pl-7 space-y-1.5">
          {compact && (
            <div className="flex items-center gap-2">
              <AssigneeButton
                assignee={task.assignee}
                users={users}
                onSave={gid => void onUpdate(task.gid, { assignee_gid: gid })}
              />
              <DueDateChip
                due_on={task.due_on}
                completed={task.completed}
                onSave={val => void onUpdate(task.gid, { due_on: val })}
              />
            </div>
          )}
          <Textarea
            value={notesVal}
            onChange={e => setNotesVal(e.target.value)}
            onBlur={() => void saveNotes()}
            placeholder="Add a note..."
            className="text-[11px] h-14 resize-none w-full border-gray-100 focus:border-gray-300"
          />
        </div>
      )}
    </li>
  )
}
