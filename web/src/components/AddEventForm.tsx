import { useState } from 'react'
import { CalendarPlus } from 'lucide-react'
import { createOwnedEvent } from '../lib/calendar'

interface Props {
  date: string                  // YYYY-MM-DD
  onEventCreated: () => void
}

export default function AddEventForm({ date, onEventCreated }: Props) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('10:00')
  const [allDay, setAllDay] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!title.trim()) return
    setSaving(true)
    setError(null)
    try {
      await createOwnedEvent({
        summary: title.trim(),
        start: allDay ? date : `${date}T${startTime}:00`,
        end: allDay ? date : `${date}T${endTime}:00`,
        allDay,
      })
      // Refresh after a short delay so Google has time to index the new event
      setTimeout(onEventCreated, 800)
      setTitle('')
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create event')
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
        <CalendarPlus size={11} />
        add event
      </button>
    )
  }

  return (
    <div className="px-2 py-2 border-t border-gray-100 bg-gray-50/40 space-y-1.5">
      <input
        autoFocus
        className="w-full text-xs bg-white border border-gray-200 rounded px-2 py-1 outline-none focus:border-blue-400"
        placeholder="Event title..."
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && title.trim()) void submit()
          if (e.key === 'Escape') { setTitle(''); setOpen(false) }
        }}
      />
      <div className="flex items-center gap-1 flex-wrap">
        <label className="flex items-center gap-1 text-[10px] text-gray-600">
          <input
            type="checkbox"
            checked={allDay}
            onChange={e => setAllDay(e.target.checked)}
            className="h-3 w-3"
          />
          all day
        </label>
        {!allDay && (
          <>
            <input
              type="time"
              value={startTime}
              onChange={e => setStartTime(e.target.value)}
              className="text-[10px] h-6 border border-gray-200 rounded px-1 bg-white"
            />
            <span className="text-[10px] text-gray-400">–</span>
            <input
              type="time"
              value={endTime}
              onChange={e => setEndTime(e.target.value)}
              className="text-[10px] h-6 border border-gray-200 rounded px-1 bg-white"
            />
          </>
        )}
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => void submit()}
          disabled={saving || !title.trim()}
          className="text-[10px] h-6 px-2 bg-gray-900 text-white rounded disabled:opacity-40 hover:bg-gray-700 transition-colors"
        >
          {saving ? 'Adding...' : 'Add'}
        </button>
        <button
          onClick={() => { setTitle(''); setOpen(false); setError(null) }}
          className="text-[10px] h-6 px-1 text-gray-400 hover:text-gray-600"
        >
          ✕
        </button>
      </div>
      {error && <p className="text-[10px] text-red-500">{error}</p>}
    </div>
  )
}
