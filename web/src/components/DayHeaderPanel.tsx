import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { X, Plus, EyeOff, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createOwnedEvent } from '../lib/calendar'
import type { CalendarEvent, CalendarOverride } from '../types'

interface Props {
  date: string                    // 'YYYY-MM-DD'
  rawEvents: CalendarEvent[]      // un-filtered (so we can show hidden events)
  overrides: CalendarOverride[]
  onUnhide: (overrideId: string) => Promise<void>
  onEventCreated: () => void      // trigger calendar refresh
  onClose: () => void
}

export default function DayHeaderPanel({
  date, rawEvents, overrides, onUnhide, onEventCreated, onClose,
}: Props) {
  const [mode, setMode] = useState<'menu' | 'add'>('menu')
  const [title, setTitle] = useState('')
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('10:00')
  const [allDay, setAllDay] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Find hidden overrides for this date and link them to their event titles
  const hiddenForDate = overrides.filter(o => o.event_date === date && o.hidden)
  const eventsByKey = new Map(rawEvents.map(e => [`${e.id}|${e.start.slice(0, 10)}`, e]))

  async function handleAdd() {
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
      onEventCreated()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create event')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
          {format(parseISO(`${date}T00:00:00`), 'EEEE, MMM d')}
        </span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <X size={14} />
        </button>
      </div>

      {mode === 'menu' && (
        <>
          <Button
            size="sm"
            variant="outline"
            className="text-xs h-7 w-full justify-start"
            onClick={() => setMode('add')}
          >
            <Plus size={12} className="mr-1" />
            Add event
          </Button>

          {hiddenForDate.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] text-gray-500 uppercase tracking-wider flex items-center gap-1">
                <EyeOff size={10} />
                Hidden ({hiddenForDate.length})
              </div>
              {hiddenForDate.map(o => {
                const ev = eventsByKey.get(`${o.event_key}|${o.event_date}`)
                const label = ev?.title || ev?.amion_kind || o.event_key
                return (
                  <div key={o.id} className="flex items-center justify-between bg-white rounded-md border border-gray-200 px-2 py-1.5">
                    <span className="text-xs text-gray-700 truncate">{label}</span>
                    <button
                      onClick={() => void onUnhide(o.id)}
                      className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 shrink-0 ml-2"
                    >
                      <Undo2 size={11} />
                      Restore
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {mode === 'add' && (
        <div className="space-y-2">
          <Input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Event title"
            className="text-xs h-8"
            autoFocus
          />
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={allDay}
                onChange={e => setAllDay(e.target.checked)}
              />
              All day
            </label>
          </div>
          {!allDay && (
            <div className="flex items-center gap-2">
              <Input
                type="time"
                value={startTime}
                onChange={e => setStartTime(e.target.value)}
                className="w-28 h-8 text-xs"
              />
              <span className="text-gray-400 text-xs">to</span>
              <Input
                type="time"
                value={endTime}
                onChange={e => setEndTime(e.target.value)}
                className="w-28 h-8 text-xs"
              />
            </div>
          )}
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={handleAdd}
              disabled={saving || !title.trim()}
              className="text-xs h-7"
            >
              {saving ? 'Adding...' : 'Add'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setMode('menu')}
              disabled={saving}
              className="text-xs h-7"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
