import { useState } from 'react'
import { Plus } from 'lucide-react'
import { createTask } from '../../lib/asana'
import type { AsanaTask, AsanaUser } from '../../types'
import { firstWord } from './helpers'

interface Props {
  users: AsanaUser[]
  selfGid: string
  defaultDueDate?: string | null  // YYYY-MM-DD
  onAdd: (task: AsanaTask) => void
}

export default function AddTaskForm({ users, selfGid, defaultDueDate, onAdd }: Props) {
  const [name, setName] = useState('')
  const [dueDate, setDueDate] = useState(defaultDueDate ?? '')
  const [assigneeGid, setAssigneeGid] = useState(selfGid)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

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
      setDueDate(defaultDueDate ?? '')
      setAssigneeGid(selfGid)
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full text-left px-2 py-1.5 text-[11px] text-gray-400 hover:text-gray-700 hover:bg-gray-50 flex items-center gap-1 transition-colors"
      >
        <Plus size={11} />
        add task
      </button>
    )
  }

  return (
    <div className="px-2 py-2 border-t border-gray-100 bg-gray-50/40 space-y-1.5">
      <input
        autoFocus
        className="w-full text-xs bg-white border border-gray-200 rounded px-2 py-1 outline-none focus:border-blue-400"
        placeholder="Task name..."
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && name.trim()) void submit()
          if (e.key === 'Escape') { setName(''); setOpen(false) }
        }}
      />
      <div className="flex items-center gap-1 flex-wrap">
        {users.length > 1 && (
          <select
            value={assigneeGid}
            onChange={e => setAssigneeGid(e.target.value)}
            className="text-[10px] h-6 border border-gray-200 rounded px-1 bg-white"
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
          className="text-[10px] h-6 border border-gray-200 rounded px-1 bg-white"
        />
        <button
          onClick={() => void submit()}
          disabled={saving || !name.trim()}
          className="text-[10px] h-6 px-2 bg-gray-900 text-white rounded disabled:opacity-40 hover:bg-gray-700 transition-colors"
        >
          Add
        </button>
        <button
          onClick={() => { setName(''); setOpen(false) }}
          className="text-[10px] h-6 px-1 text-gray-400 hover:text-gray-600"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
