import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { X } from 'lucide-react'
import { createTask } from '../../lib/asana'
import type { AsanaTask, AsanaUser } from '../../types'
import { firstWord } from './helpers'

interface Props {
  users: AsanaUser[]
  selfGid: string
  defaultDueDate?: string | null  // YYYY-MM-DD
  onAdd: (task: AsanaTask) => void
  onClose: () => void
}

export default function AddTaskForm({ users, selfGid, defaultDueDate, onAdd, onClose }: Props) {
  const [name, setName] = useState('')
  const [dueDate, setDueDate] = useState(defaultDueDate ?? format(new Date(), 'yyyy-MM-dd'))
  // Initialize to selfGid if available, else the first user — mirrors what the
  // <select> shows by default so visual == actual.
  const [assigneeGid, setAssigneeGid] = useState(selfGid || users[0]?.gid || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // If selfGid or users load AFTER this form mounts (race condition on first
  // open), sync the assignee so the dropdown's displayed value matches state.
  useEffect(() => {
    if (!assigneeGid && (selfGid || users[0]?.gid)) {
      setAssigneeGid(selfGid || users[0].gid)
    }
  }, [selfGid, users, assigneeGid])

  const submit = async () => {
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    try {
      const fallbackAssignee = assigneeGid || selfGid || users[0]?.gid
      const task = await createTask({
        name: name.trim(),
        due_on: dueDate || undefined,
        assignee: fallbackAssignee || undefined,
      })
      onAdd(task)
      setName('')
      onClose()
    } catch (e) {
      console.error('AddTaskForm create failed:', e)
      setError(e instanceof Error ? e.message : 'Failed to create task')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="px-4 py-3 bg-hb-card border border-hb-border-soft rounded-xl shadow-sm space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-hb-fg-secondary uppercase tracking-[.1em]">New task</span>
        <button onClick={onClose} className="text-hb-fg-muted hover:text-hb-fg-secondary">
          <X size={14} />
        </button>
      </div>

      <input
        autoFocus
        className="w-full text-sm bg-hb-card border border-hb-border-soft rounded-md px-2 py-1.5 outline-none focus:border-hb-fg-faint"
        placeholder="Task name..."
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && name.trim()) void submit()
          if (e.key === 'Escape') onClose()
        }}
      />

      <div className="flex items-center gap-2 flex-wrap">
        {users.length > 1 && (
          <select
            value={assigneeGid}
            onChange={e => setAssigneeGid(e.target.value)}
            className="text-xs h-7 border border-hb-border-soft rounded-md px-2 bg-hb-card"
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
          className="text-xs h-7 border border-hb-border-soft rounded-md px-2 bg-hb-card"
        />

        <div className="flex-1" />

        <button
          onClick={() => void submit()}
          disabled={saving || !name.trim()}
          className="text-xs h-7 px-3 bg-hb-fg text-white rounded-md disabled:opacity-40 hover:bg-black transition-colors"
        >
          {saving ? 'Adding...' : 'Add task'}
        </button>
      </div>

      {error && (
        <div className="px-2 py-1 bg-[#fcf0f0] border border-[#f1d8d8] rounded">
          <p className="text-[11px] text-[#a14040]">{error}</p>
        </div>
      )}
    </div>
  )
}
