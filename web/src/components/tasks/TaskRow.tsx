import { useEffect, useState } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
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
    <Popover open={expanded} onOpenChange={setExpanded}>
      <li className="group border-b border-hb-border-rule last:border-0">
      <PopoverAnchor asChild>
      <div className="flex items-center gap-1.5 px-2 py-1.5 hover:bg-black/[.02]">
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
            className="flex-1 min-w-0 text-[13px] bg-transparent border-b border-hb-fg outline-none py-0.5"
          />
        ) : (
          <span
            onClick={() => !task.completed && setNameEditing(true)}
            className={`flex-1 min-w-0 text-[13px] ${
              task.completed
                ? 'line-through text-hb-fg-muted'
                : 'text-hb-fg cursor-pointer hover:text-hb-fg'
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
          className="text-[10px] text-hb-fg-muted hover:text-hb-fg transition-colors shrink-0 opacity-50 group-hover:opacity-100"
        >
          {expanded ? '▾' : '▸'}
        </button>

        {confirmDelete ? (
          <span className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => { setConfirmDelete(false); onDelete(task.gid) }}
              className="text-[10px] text-[#a14040] hover:text-[#7f3232] font-medium"
            >Yes</button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="text-[10px] text-hb-fg-muted hover:text-hb-fg-secondary"
            >No</button>
          </span>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="opacity-0 group-hover:opacity-100 text-hb-fg-faint hover:text-[#a14040] text-[10px] transition-all shrink-0"
            aria-label="Delete"
          >✕</button>
        )}
      </div>

      </PopoverAnchor>
      <PopoverContent
        className="w-[360px] p-4 space-y-3"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="text-sm font-semibold text-hb-fg break-words">{task.name}</div>
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
        <Textarea
          value={notesVal}
          onChange={e => setNotesVal(e.target.value)}
          onBlur={() => void saveNotes()}
          placeholder="Add a note..."
          className="text-xs min-h-[100px] resize-y w-full"
        />
      </PopoverContent>
    </li>
    </Popover>
  )
}
