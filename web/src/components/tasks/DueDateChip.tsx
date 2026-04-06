import { useState } from 'react'
import { format, isToday, parseISO } from 'date-fns'

interface Props {
  due_on: string | null
  completed: boolean
  onSave: (val: string | null) => void
}

export default function DueDateChip({ due_on, completed, onSave }: Props) {
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
        className="text-[10px] border border-gray-200 rounded px-1 py-0.5 w-24 outline-none shrink-0"
      />
    )
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className={`text-[10px] px-1.5 py-0.5 rounded transition-colors shrink-0 ${chipClass}`}
    >
      {due_on ? format(parseISO(due_on), 'MMM d') : '—'}
    </button>
  )
}
