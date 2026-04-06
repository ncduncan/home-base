import { useEffect, useRef, useState } from 'react'
import type { AsanaTask, AsanaUser } from '../../types'
import { avatarColor, firstWord, initials } from './helpers'

interface Props {
  assignee: AsanaTask['assignee']
  users: AsanaUser[]
  onSave: (gid: string | null) => void
}

export default function AssigneeButton({ assignee, users, onSave }: Props) {
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
        className={`w-5 h-5 rounded-full text-[10px] font-semibold flex items-center justify-center ${color} hover:ring-2 hover:ring-offset-1 hover:ring-gray-300 transition-all`}
      >
        {assignee ? initials(assignee.name) : '?'}
      </button>
      {open && (
        <div className="absolute right-0 top-7 z-20 bg-white rounded-lg shadow-lg border border-gray-100 py-1 min-w-[9rem]">
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
              <span className={`w-5 h-5 rounded-full text-[10px] font-semibold flex items-center justify-center shrink-0 ${avatarColor(u.name)}`}>
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
