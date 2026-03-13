import { useCallback, useEffect, useRef, useState } from 'react'
import { format, parseISO, isBefore, isToday, startOfDay } from 'date-fns'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  fetchWorkspaceUsers,
  createTask,
  updateTask,
  deleteTask,
} from '../lib/asana'
import type { AsanaTask, AsanaUser } from '../types'

function firstWord(name: string) {
  return name.split(' ')[0]
}

function assigneeLabel(assignee: AsanaTask['assignee'] | null): string {
  if (!assignee) return 'Unassigned'
  return firstWord(assignee.name)
}

// ── Section header ─────────────────────────────────────────────────────────────
function SectionHeader({ label, color = 'text-gray-400' }: { label: string; color?: string }) {
  return (
    <div className={`px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wider ${color}`}>
      {label}
    </div>
  )
}

// ── Add form ──────────────────────────────────────────────────────────────────
function AddForm({
  users,
  selfGid,
  onAdd,
}: {
  users: AsanaUser[]
  selfGid: string
  onAdd: (t: AsanaTask) => void
}) {
  const [name, setName] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [assigneeGid, setAssigneeGid] = useState(selfGid)
  const [saving, setSaving] = useState(false)

  // keep default assignee in sync when selfGid resolves
  useEffect(() => { if (selfGid && !assigneeGid) setAssigneeGid(selfGid) }, [selfGid, assigneeGid])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try {
      const task = await createTask({
        name: name.trim(),
        due_on: dueDate || undefined,
        assignee: assigneeGid || undefined,
      })
      onAdd(task)
      setName('')
      setDueDate('')
      setAssigneeGid(selfGid)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={e => void handleSubmit(e)} className="p-4 border-b border-gray-100 space-y-2">
      <Input
        placeholder="Add a task..."
        value={name}
        onChange={e => setName(e.target.value)}
        className="text-sm"
      />
      <div className="flex gap-2">
        <div className="flex flex-col gap-1.5 shrink-0 flex-1">
          <div className="flex gap-2">
            <Input
              type="date"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
              className="text-xs h-8 flex-1"
            />
            {users.length > 1 && (
              <select
                value={assigneeGid}
                onChange={e => setAssigneeGid(e.target.value)}
                className="text-xs h-8 rounded-md border border-gray-200 px-2 bg-white"
              >
                {users.map(u => (
                  <option key={u.gid} value={u.gid}>{firstWord(u.name)}</option>
                ))}
              </select>
            )}
          </div>
        </div>
        <Button type="submit" disabled={saving || !name.trim()} size="sm" className="h-8 text-xs shrink-0">
          Add
        </Button>
      </div>
    </form>
  )
}

// ── Single task row ────────────────────────────────────────────────────────────
function TaskRow({
  task,
  users,
  selfGid,
  onToggle,
  onDelete,
  onUpdate,
}: {
  task: AsanaTask
  users: AsanaUser[]
  selfGid: string
  onToggle: (gid: string, completed: boolean) => void
  onDelete: (gid: string) => void
  onUpdate: (gid: string, patch: Partial<Pick<AsanaTask, 'name' | 'notes' | 'due_on'> & { assignee_gid: string | null }>) => Promise<void>
}) {
  const today = startOfDay(new Date())
  const isOverdue = !task.completed && task.due_on
    ? isBefore(parseISO(task.due_on), today)
    : false

  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(task.name)
  const [editNotes, setEditNotes] = useState(task.notes ?? '')
  const [editDue, setEditDue] = useState(task.due_on ?? '')
  const [editAssignee, setEditAssignee] = useState(task.assignee?.gid ?? '')
  const savingRef = useRef(false)

  const save = useCallback(async () => {
    if (savingRef.current || !editName.trim()) return
    savingRef.current = true
    await onUpdate(task.gid, {
      name: editName.trim(),
      notes: editNotes.trim() || null,
      due_on: editDue || null,
      assignee_gid: editAssignee || null,
    })
    savingRef.current = false
    setEditing(false)
  }, [editName, editNotes, editDue, editAssignee, onUpdate, task.gid])

  const cancel = useCallback(() => {
    setEditName(task.name)
    setEditNotes(task.notes ?? '')
    setEditDue(task.due_on ?? '')
    setEditAssignee(task.assignee?.gid ?? '')
    setEditing(false)
  }, [task.name, task.notes, task.due_on, task.assignee])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void save() }
    if (e.key === 'Escape') cancel()
  }

  if (editing) {
    return (
      <li className="px-4 py-3 flex items-start gap-3 bg-blue-50/30 border-b border-gray-50">
        <Checkbox
          checked={task.completed}
          onCheckedChange={checked => onToggle(task.gid, checked as boolean)}
          className="mt-1 shrink-0"
        />
        <div className="flex-1 min-w-0 space-y-1.5">
          <Input
            autoFocus
            value={editName}
            onChange={e => setEditName(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => void save()}
            className="text-sm h-7"
          />
          <Textarea
            placeholder="Notes"
            value={editNotes}
            onChange={e => setEditNotes(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => void save()}
            className="text-xs h-12 resize-none"
          />
          <div className="flex gap-2">
            <Input
              type="date"
              value={editDue}
              onChange={e => setEditDue(e.target.value)}
              onBlur={() => void save()}
              className="text-xs h-7 w-36"
            />
            {users.length > 1 && (
              <select
                value={editAssignee}
                onChange={e => setEditAssignee(e.target.value)}
                onBlur={() => void save()}
                className="text-xs h-7 rounded-md border border-gray-200 px-2 bg-white"
              >
                <option value="">Unassigned</option>
                {users.map(u => (
                  <option key={u.gid} value={u.gid}>{firstWord(u.name)}</option>
                ))}
              </select>
            )}
          </div>
          <p className="text-xs text-gray-300">Enter to save · Esc to cancel</p>
        </div>
      </li>
    )
  }

  const label = assigneeLabel(task.assignee)
  const isAssignedToSelf = task.assignee?.gid === selfGid

  return (
    <li className={`flex items-start gap-3 px-4 py-3 group hover:bg-gray-50/50 ${task.completed ? 'opacity-50' : ''}`}>
      <Checkbox
        checked={task.completed}
        onCheckedChange={checked => onToggle(task.gid, checked as boolean)}
        className="mt-0.5 shrink-0"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            onClick={() => { if (!task.completed) setEditing(true) }}
            className={`text-sm ${task.completed ? 'line-through text-gray-400' : 'text-gray-900'} ${!task.completed ? 'cursor-pointer hover:text-blue-600' : ''}`}
          >
            {task.name}
          </span>
          {!isAssignedToSelf && label !== 'Unassigned' && (
            <span className="text-xs text-gray-400 bg-gray-100 rounded px-1.5 py-0.5">{label}</span>
          )}
        </div>
        {task.notes && (
          <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{task.notes}</p>
        )}
        {task.due_on && (
          <span className={`text-xs font-medium mt-0.5 block ${isOverdue ? 'text-red-500' : 'text-gray-400'}`}>
            {isOverdue ? 'Overdue · ' : ''}{format(parseISO(task.due_on), 'MMM d')}
          </span>
        )}
        {task.projects.length > 0 && (
          <span className="text-xs text-gray-300 mt-0.5 block">{task.projects.join(', ')}</span>
        )}
      </div>
      <button
        onClick={() => onDelete(task.gid)}
        className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 text-xs transition-opacity shrink-0 mt-0.5"
        aria-label="Delete task"
      >
        ✕
      </button>
    </li>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
interface Props {
  tasks: AsanaTask[]
  loading: boolean
  currentUserEmail: string
  onSetTasks: React.Dispatch<React.SetStateAction<AsanaTask[]>>
}

export default function AsanaTaskList({ tasks, loading, currentUserEmail, onSetTasks }: Props) {
  const [users, setUsers] = useState<AsanaUser[]>([])
  const [selfGid, setSelfGid] = useState('')

  useEffect(() => {
    fetchWorkspaceUsers().then(all => {
      setUsers(all)
      const self = all.find(u => u.email === currentUserEmail)
      if (self) setSelfGid(self.gid)
    }).catch(() => {/* non-critical */})
  }, [currentUserEmail])

  const addTask = useCallback((task: AsanaTask) => {
    onSetTasks(prev => [task, ...prev])
  }, [onSetTasks])

  const toggleTask = useCallback(async (gid: string, completed: boolean) => {
    onSetTasks(prev => prev.map(t => t.gid === gid ? { ...t, completed } : t))
    try {
      await updateTask(gid, { completed })
    } catch {
      onSetTasks(prev => prev.map(t => t.gid === gid ? { ...t, completed: !completed } : t))
    }
  }, [onSetTasks])

  const removeTask = useCallback(async (gid: string) => {
    const backup = tasks.find(t => t.gid === gid)
    onSetTasks(prev => prev.filter(t => t.gid !== gid))
    try {
      await deleteTask(gid)
    } catch {
      if (backup) onSetTasks(prev => [backup, ...prev])
    }
  }, [tasks, onSetTasks])

  const editTask = useCallback(async (
    gid: string,
    patch: Partial<Pick<AsanaTask, 'name' | 'notes' | 'due_on'> & { assignee_gid: string | null }>,
  ) => {
    const { assignee_gid, ...rest } = patch
    onSetTasks(prev => prev.map(t => {
      if (t.gid !== gid) return t
      const newAssignee = assignee_gid !== undefined
        ? (assignee_gid ? (users.find(u => u.gid === assignee_gid) ? { gid: assignee_gid, name: users.find(u => u.gid === assignee_gid)!.name } : t.assignee) : null)
        : t.assignee
      return { ...t, ...rest, assignee: newAssignee }
    }))
    const apiPatch: Parameters<typeof updateTask>[1] = { ...rest }
    if (assignee_gid !== undefined) apiPatch.assignee = assignee_gid
    await updateTask(gid, apiPatch)
  }, [onSetTasks, users])

  const rowProps = (task: AsanaTask) => ({
    task,
    users,
    selfGid,
    onToggle: (gid: string, c: boolean) => void toggleTask(gid, c),
    onDelete: (gid: string) => void removeTask(gid),
    onUpdate: (gid: string, patch: Parameters<typeof editTask>[1]) => editTask(gid, patch),
  })

  if (loading) return <div className="p-4 text-gray-400 text-sm">Loading tasks...</div>

  const today = format(new Date(), 'yyyy-MM-dd')
  const incomplete = tasks.filter(t => !t.completed)

  const overdue = incomplete.filter(t => t.due_on && t.due_on < today)
  const dueToday = incomplete.filter(t => t.due_on && isToday(parseISO(t.due_on)))
  const dueThisWeek = incomplete.filter(t => t.due_on && t.due_on > today)

  const complete = tasks.filter(t => t.completed)

  return (
    <div>
      <AddForm users={users} selfGid={selfGid} onAdd={addTask} />

      {overdue.length > 0 && (
        <>
          <SectionHeader label="Overdue" color="text-red-400" />
          <ul className="divide-y divide-gray-50">
            {overdue.map(task => <TaskRow key={task.gid} {...rowProps(task)} />)}
          </ul>
        </>
      )}

      {dueToday.length > 0 && (
        <>
          <SectionHeader label="Due Today" color="text-amber-500" />
          <ul className="divide-y divide-gray-50">
            {dueToday.map(task => <TaskRow key={task.gid} {...rowProps(task)} />)}
          </ul>
        </>
      )}

      {dueThisWeek.length > 0 && (
        <>
          <SectionHeader label="This Week" />
          <ul className="divide-y divide-gray-50">
            {dueThisWeek.map(task => <TaskRow key={task.gid} {...rowProps(task)} />)}
          </ul>
        </>
      )}

      {overdue.length === 0 && dueToday.length === 0 && dueThisWeek.length === 0 && (
        <p className="px-4 py-4 text-sm text-gray-300">No tasks due in the next week.</p>
      )}

      {complete.length > 0 && (
        <details className="border-t border-gray-100">
          <summary className="px-4 py-2 text-xs text-gray-400 cursor-pointer hover:text-gray-600 select-none list-none flex items-center gap-1">
            <span className="text-gray-300">▸</span> {complete.length} completed
          </summary>
          <ul className="divide-y divide-gray-50">
            {complete.map(task => <TaskRow key={task.gid} {...rowProps(task)} />)}
          </ul>
        </details>
      )}
    </div>
  )
}
