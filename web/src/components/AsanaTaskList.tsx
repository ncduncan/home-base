import { useCallback, useEffect, useRef, useState } from 'react'
import { format, parseISO, isToday, formatDistanceToNow } from 'date-fns'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import {
  fetchWorkspaceUsers,
  createTask,
  updateTask,
  deleteTask,
} from '../lib/asana'
import type { AsanaTask, AsanaUser } from '../types'

function initials(name: string) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

function firstWord(name: string) {
  return name.split(' ')[0]
}

const AVATAR_COLORS = [
  'bg-violet-200 text-violet-800',
  'bg-emerald-200 text-emerald-800',
  'bg-rose-200 text-rose-800',
  'bg-orange-200 text-orange-800',
  'bg-teal-200 text-teal-800',
]
function avatarColor(name: string) {
  const first = name.split(' ')[0].toLowerCase()
  if (first === 'nat') return 'bg-blue-600 text-white'
  if (first.startsWith('cait')) return 'bg-yellow-100 text-yellow-800'
  let hash = 0
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
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
function AddForm({ users, selfGid, onAdd }: {
  users: AsanaUser[]
  selfGid: string
  onAdd: (t: AsanaTask) => void
}) {
  const [name, setName] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [assigneeGid, setAssigneeGid] = useState(selfGid)
  const [expanded, setExpanded] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (selfGid && !assigneeGid) setAssigneeGid(selfGid) }, [selfGid, assigneeGid])

  const submit = async () => {
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
      setExpanded(false)
    } finally {
      setSaving(false)
    }
  }

  const cancel = () => { setName(''); setDueDate(''); setAssigneeGid(selfGid); setExpanded(false) }

  return (
    <div className="px-4 py-3 border-b border-gray-100">
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded border-2 border-gray-300 shrink-0" />
        <input
          className="flex-1 text-sm bg-transparent outline-none placeholder-gray-300"
          placeholder="Add a task..."
          value={name}
          onChange={e => { setName(e.target.value); if (e.target.value) setExpanded(true) }}
          onFocus={() => { if (name) setExpanded(true) }}
          onKeyDown={e => {
            if (e.key === 'Enter' && name.trim()) void submit()
            if (e.key === 'Escape') cancel()
          }}
        />
      </div>
      {expanded && (
        <div className="mt-2.5 pl-6 flex items-center gap-2 flex-wrap">
          {users.length > 1 && (
            <select
              value={assigneeGid}
              onChange={e => setAssigneeGid(e.target.value)}
              className="text-xs h-7 border border-gray-200 rounded-md px-2 bg-white"
            >
              {users.map(u => (
                <option key={u.gid} value={u.gid}>{firstWord(u.name)}</option>
              ))}
            </select>
          )}
          <input
            type="date"
            value={dueDate}
            onChange={e => setDueDate(e.target.value)}
            className="text-xs h-7 border border-gray-200 rounded-md px-2 bg-white"
          />
          <button
            onClick={() => void submit()}
            disabled={saving || !name.trim()}
            className="text-xs h-7 px-3 bg-gray-900 text-white rounded-md disabled:opacity-40 hover:bg-gray-700 transition-colors"
          >
            Add task
          </button>
          <button onClick={cancel} className="text-xs h-7 px-2 text-gray-400 hover:text-gray-600">
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}

// ── Assignee avatar + dropdown ─────────────────────────────────────────────────
function AssigneeButton({ assignee, users, onSave }: {
  assignee: AsanaTask['assignee']
  users: AsanaUser[]
  onSave: (gid: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const color = assignee ? avatarColor(assignee.name) : 'bg-gray-100 text-gray-400'

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen(!open)}
        title={assignee?.name ?? 'Unassigned'}
        className={`w-6 h-6 rounded-full text-xs font-semibold flex items-center justify-center ${color} hover:ring-2 hover:ring-offset-1 hover:ring-gray-300 transition-all`}
      >
        {assignee ? initials(assignee.name) : '?'}
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-20 bg-white rounded-lg shadow-lg border border-gray-100 py-1 min-w-[9rem]">
          <button
            onMouseDown={() => { onSave(null); setOpen(false) }}
            className="w-full text-left px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-50"
          >
            Unassigned
          </button>
          {users.map(u => (
            <button
              key={u.gid}
              onMouseDown={() => { onSave(u.gid); setOpen(false) }}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 flex items-center gap-2"
            >
              <span className={`w-5 h-5 rounded-full text-xs font-semibold flex items-center justify-center shrink-0 ${avatarColor(u.name)}`}>
                {initials(u.name)}
              </span>
              {firstWord(u.name)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Due date chip ──────────────────────────────────────────────────────────────
function DueDateChip({ due_on, completed, onSave }: {
  due_on: string | null
  completed: boolean
  onSave: (val: string | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const today = format(new Date(), 'yyyy-MM-dd')
  const isOverdue = !completed && due_on && due_on < today
  const isDueToday = !completed && due_on && isToday(parseISO(due_on))

  const chipClass = isOverdue
    ? 'text-red-500 bg-red-50 hover:bg-red-100'
    : isDueToday
      ? 'text-amber-600 bg-amber-50 hover:bg-amber-100'
      : due_on
        ? 'text-gray-500 bg-gray-100 hover:bg-gray-200'
        : 'text-gray-300 hover:bg-gray-100 hover:text-gray-500'

  if (editing) {
    return (
      <input
        autoFocus
        type="date"
        defaultValue={due_on ?? ''}
        onChange={e => { onSave(e.target.value || null); setEditing(false) }}
        onBlur={() => setEditing(false)}
        className="text-xs border border-gray-200 rounded px-1 py-0.5 w-28 outline-none shrink-0"
      />
    )
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className={`text-xs px-1.5 py-0.5 rounded transition-colors shrink-0 ${chipClass}`}
    >
      {due_on ? format(parseISO(due_on), 'MMM d') : '—'}
    </button>
  )
}

// ── Single task row ────────────────────────────────────────────────────────────
function TaskRow({ task, users, onToggle, onDelete, onUpdate }: {
  task: AsanaTask
  users: AsanaUser[]
  onToggle: (gid: string, completed: boolean) => void
  onDelete: (gid: string) => void
  onUpdate: (gid: string, patch: Partial<Pick<AsanaTask, 'name' | 'notes' | 'due_on'> & { assignee_gid: string | null }>) => Promise<void>
}) {
  const [nameEditing, setNameEditing] = useState(false)
  const [nameVal, setNameVal] = useState(task.name)
  const [expanded, setExpanded] = useState(false)
  const [notesVal, setNotesVal] = useState(task.notes ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Sync when task prop updates
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
      <div className="flex items-center gap-2 px-4 py-2.5 hover:bg-gray-50/50">
        <Checkbox
          checked={task.completed}
          onCheckedChange={checked => onToggle(task.gid, checked as boolean)}
          className="shrink-0"
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
            className="flex-1 min-w-0 text-sm bg-transparent border-b border-blue-400 outline-none py-0.5"
          />
        ) : (
          <span
            onClick={() => !task.completed && setNameEditing(true)}
            className={`flex-1 min-w-0 text-sm truncate ${
              task.completed
                ? 'line-through text-gray-400'
                : 'text-gray-900 cursor-pointer hover:text-blue-600'
            }`}
          >
            {task.name}
          </span>
        )}

        {task.projects.length > 0 && (
          <span className="hidden sm:block text-xs text-gray-300 shrink-0 truncate max-w-[5rem]">
            {task.projects[0]}
          </span>
        )}

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

        <button
          onClick={() => setExpanded(!expanded)}
          title={expanded ? 'Hide notes' : 'Show notes'}
          className="text-sm text-gray-400 hover:text-gray-700 transition-colors shrink-0 opacity-50 group-hover:opacity-100"
        >
          {expanded ? '▾' : '▸'}
        </button>

        {confirmDelete ? (
          <span className="flex items-center gap-1 shrink-0">
            <span className="text-xs text-gray-500">Delete?</span>
            <button
              onClick={() => { setConfirmDelete(false); onDelete(task.gid) }}
              className="text-xs text-red-500 hover:text-red-700 font-medium"
            >Yes</button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="text-xs text-gray-400 hover:text-gray-600"
            >No</button>
          </span>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="opacity-0 group-hover:opacity-100 text-gray-200 hover:text-red-400 text-xs transition-all shrink-0"
            aria-label="Delete"
          >✕</button>
        )}
      </div>

      {expanded && (
        <div className="px-4 pb-3 pl-11">
          <Textarea
            value={notesVal}
            onChange={e => setNotesVal(e.target.value)}
            onBlur={() => void saveNotes()}
            placeholder="Add a note..."
            className="text-xs h-16 resize-none w-full border-gray-100 focus:border-gray-300"
          />
        </div>
      )}
    </li>
  )
}

// ── Completed task row (with confirm-delete) ────────────────────────────────────
function CompletedRow({ task, onUncomplete, onDelete }: {
  task: AsanaTask
  onUncomplete: () => void
  onDelete: () => void
}) {
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
        ? (assignee_gid
          ? (users.find(u => u.gid === assignee_gid)
            ? { gid: assignee_gid, name: users.find(u => u.gid === assignee_gid)!.name }
            : t.assignee)
          : null)
        : t.assignee
      return { ...t, ...rest, assignee: newAssignee }
    }))
    const apiPatch: Parameters<typeof updateTask>[1] = { ...rest }
    if (assignee_gid !== undefined) apiPatch.assignee = assignee_gid
    await updateTask(gid, apiPatch)
  }, [onSetTasks, users])

  const rowProps = (task: AsanaTask) => ({
    task, users,
    onToggle: (gid: string, c: boolean) => void toggleTask(gid, c),
    onDelete: (gid: string) => void removeTask(gid),
    onUpdate: (gid: string, patch: Parameters<typeof editTask>[1]) => editTask(gid, patch),
  })

  if (loading) return <div className="p-4 text-gray-400 text-sm">Loading tasks...</div>

  // Sort incomplete tasks by due date (overdue first, then ascending, nulls last)
  const incomplete = [...tasks.filter(t => !t.completed)].sort((a, b) => {
    if (!a.due_on && !b.due_on) return 0
    if (!a.due_on) return 1
    if (!b.due_on) return -1
    return a.due_on.localeCompare(b.due_on)
  })

  // Group by assignee, maintaining workspace user order
  const groupMap = new Map<string, { label: string; tasks: AsanaTask[] }>()
  for (const u of users) groupMap.set(u.gid, { label: firstWord(u.name), tasks: [] })
  groupMap.set('unassigned', { label: 'Unassigned', tasks: [] })
  for (const task of incomplete) {
    const key = task.assignee?.gid ?? 'unassigned'
    if (groupMap.has(key)) {
      groupMap.get(key)!.tasks.push(task)
    } else {
      groupMap.set(key, { label: task.assignee ? firstWord(task.assignee.name) : 'Unassigned', tasks: [task] })
    }
  }
  const groups = [...groupMap.entries()]
    .filter(([, g]) => g.tasks.length > 0)
    .map(([key, g]) => ({ key, ...g }))

  const recentlyCompleted = tasks
    .filter(t => t.completed)
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))

  return (
    <div>
      <AddForm users={users} selfGid={selfGid} onAdd={addTask} />

      {groups.length > 0 ? groups.map(group => (
        <div key={group.key}>
          <SectionHeader label={group.label} />
          <ul>{group.tasks.map(task => <TaskRow key={task.gid} {...rowProps(task)} />)}</ul>
        </div>
      )) : (
        <p className="px-4 py-4 text-sm text-gray-300">No tasks due in the next week.</p>
      )}

      {recentlyCompleted.length > 0 && (
        <details className="border-t border-gray-100">
          <summary className="px-4 py-2.5 text-xs text-gray-400 cursor-pointer hover:text-gray-600 select-none list-none flex items-center gap-1.5">
            <span className="text-gray-300">▸</span>
            Completed recently ({recentlyCompleted.length})
          </summary>
          <ul>
            {recentlyCompleted.map(task => (
              <CompletedRow key={task.gid} task={task} onUncomplete={() => void toggleTask(task.gid, false)} onDelete={() => void removeTask(task.gid)} />
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
