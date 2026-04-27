import { useState } from 'react'
import { format } from 'date-fns'
import { X } from 'lucide-react'
import type { HomebaseEvent } from '../lib/homebase-events'
import { OWNER_LABELS, OWNER_EMAILS } from '../lib/owners'

interface Props {
  defaultDate: string           // YYYY-MM-DD
  currentUserEmail: string
  onCreate: (fields: Omit<HomebaseEvent, 'id'>) => Promise<void>
  onClose: () => void
}

export default function AddEventForm({ defaultDate, currentUserEmail, onCreate, onClose }: Props) {
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(defaultDate || format(new Date(), 'yyyy-MM-dd'))
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('10:00')
  const [allDay, setAllDay] = useState(false)
  const [owner, setOwner] = useState<'nat' | 'caitie'>(() => {
    const email = currentUserEmail.toLowerCase()
    if (OWNER_EMAILS.caitie && email === OWNER_EMAILS.caitie) return 'caitie'
    return 'nat'
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!title.trim()) return
    setSaving(true)
    setError(null)
    try {
      await onCreate({
        title: title.trim(),
        start_time: allDay ? date : `${date}T${startTime}:00`,
        end_time: allDay ? date : `${date}T${endTime}:00`,
        all_day: allDay,
        location: null,
        notes: null,
        owner,
        created_by: currentUserEmail,
      })
      setTitle('')
      onClose()
    } catch (e) {
      console.error('AddEventForm create failed:', e)
      setError(e instanceof Error ? e.message : 'Failed to create event')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="px-4 py-3 bg-hb-card border border-hb-border-soft rounded-xl shadow-sm space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-hb-fg-secondary uppercase tracking-[.1em]">New event</span>
        <button onClick={onClose} className="text-hb-fg-muted hover:text-hb-fg-secondary">
          <X size={14} />
        </button>
      </div>

      <input
        autoFocus
        className="w-full text-sm bg-hb-card border border-hb-border-soft rounded-md px-2 py-1.5 outline-none focus:border-hb-fg-faint"
        placeholder="Event title..."
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && title.trim()) void submit()
          if (e.key === 'Escape') onClose()
        }}
      />

      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setOwner(owner === 'nat' ? 'caitie' : 'nat')}
          title={`Owner: ${OWNER_LABELS[owner]} (click to switch)`}
          className={`w-6 h-6 rounded-full text-[11px] font-semibold flex items-center justify-center border ${
            owner === 'nat'
              ? 'bg-hb-nat-fade border-hb-nat-accent text-hb-fg'
              : 'bg-hb-cai-fade border-hb-cai-accent text-hb-fg'
          }`}
        >
          {OWNER_LABELS[owner].slice(0, 1).toUpperCase()}
        </button>

        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="text-xs h-7 border border-hb-border-soft rounded-md px-2 bg-hb-card"
        />

        <label className="flex items-center gap-1 text-xs text-hb-fg-secondary">
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
              className="text-xs h-7 border border-hb-border-soft rounded-md px-2 bg-hb-card"
            />
            <span className="text-xs text-hb-fg-muted">–</span>
            <input
              type="time"
              value={endTime}
              onChange={e => setEndTime(e.target.value)}
              className="text-xs h-7 border border-hb-border-soft rounded-md px-2 bg-hb-card"
            />
          </>
        )}

        <div className="flex-1" />

        <button
          onClick={() => void submit()}
          disabled={saving || !title.trim()}
          className="text-xs h-7 px-3 bg-hb-fg text-white rounded-md disabled:opacity-40 hover:bg-black transition-colors"
        >
          {saving ? 'Adding...' : 'Add event'}
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
