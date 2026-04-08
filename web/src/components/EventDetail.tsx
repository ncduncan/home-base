import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { X, Eye, EyeOff, Pencil, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { CalendarEvent, CalendarOverride } from '../types'

interface Props {
  event: CalendarEvent
  override: CalendarOverride | null
  userEmail: string
  onSave: (override: Omit<CalendarOverride, 'id'>) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onClose: () => void
}

const AMION_KINDS = [
  { value: 'training', label: 'Training' },
  { value: 'day', label: 'Day Shift' },
  { value: 'night', label: 'Night Shift' },
  { value: '24hr', label: '24Hr' },
  { value: 'backup', label: 'Backup' },
] as const

export default function EventDetail({ event, override, userEmail, onSave, onDelete, onClose }: Props) {
  const dateStr = event.start.slice(0, 10)
  const [hidden, setHidden] = useState(override?.hidden ?? false)
  const [startTime, setStartTime] = useState(
    override?.start_override
      ? format(parseISO(override.start_override), 'HH:mm')
      : event.all_day ? '' : format(parseISO(event.start), 'HH:mm')
  )
  const [endTime, setEndTime] = useState(
    override?.end_override
      ? format(parseISO(override.end_override), 'HH:mm')
      : event.all_day ? '' : format(parseISO(event.end), 'HH:mm')
  )
  const [amionKind, setAmionKind] = useState(
    override?.amion_kind_override ?? event.amion_kind ?? ''
  )
  const [notes, setNotes] = useState(override?.notes ?? '')
  const [saving, setSaving] = useState(false)

  const hasChanges = hidden !== (override?.hidden ?? false)
    || (startTime && `${dateStr}T${startTime}:00` !== (override?.start_override ?? (event.all_day ? '' : event.start)))
    || (endTime && `${dateStr}T${endTime}:00` !== (override?.end_override ?? (event.all_day ? '' : event.end)))
    || (event.is_amion && amionKind !== (override?.amion_kind_override ?? event.amion_kind ?? ''))
    || notes !== (override?.notes ?? '')

  async function handleSave() {
    setSaving(true)
    try {
      // Determine the end date for the override - for overnight shifts, end might be next day
      const endDateStr = event.end.slice(0, 10)
      await onSave({
        event_key: event.id,
        event_date: dateStr,
        hidden,
        title_override: null,
        start_override: startTime ? `${dateStr}T${startTime}:00` : null,
        end_override: endTime ? `${endDateStr}T${endTime}:00` : null,
        amion_kind_override: event.is_amion && amionKind !== event.amion_kind ? amionKind : null,
        notes: notes.trim() || null,
        created_by: userEmail,
      })
      onClose()
    } catch (e) {
      console.error('Failed to save override:', e)
    } finally {
      setSaving(false)
    }
  }

  async function handleReset() {
    if (!override) return
    setSaving(true)
    try {
      await onDelete(override.id)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-4 space-y-3">
      {/* Title + close */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-900 truncate">
            {event.is_amion ? (event.amion_kind ?? 'Shift') : event.title}
          </div>
          <div className="text-[11px] text-gray-500 mt-0.5">
            {event.is_amion ? 'Shift override' : 'Event details'}
          </div>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 shrink-0 -mr-1 -mt-1 p-1">
          <X size={14} />
        </button>
      </div>

      {/* Info line */}
      <div className="text-[11px] text-gray-400 break-words">
        {event.calendar_name}
        {event.organizer_email && ` · ${event.organizer_email}`}
        {event.overridden && (
          <span className="ml-1 text-amber-500">(overridden)</span>
        )}
      </div>

      {/* Hide toggle */}
      <button
        onClick={() => setHidden(!hidden)}
        className={`flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
          hidden
            ? 'bg-red-50 border-red-200 text-red-600'
            : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
        }`}
      >
        {hidden ? <EyeOff size={12} /> : <Eye size={12} />}
        {hidden ? 'Hidden — will not show on calendar' : 'Hide this event'}
      </button>

      {!hidden && (
        <>
          {/* Time adjustment (not for all-day events without existing times) */}
          {!event.all_day && (
            <div className="flex items-center gap-2">
              <Pencil size={12} className="text-gray-400 shrink-0" />
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

          {/* AMION kind override */}
          {event.is_amion && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Shift type:</span>
              <select
                value={amionKind}
                onChange={e => setAmionKind(e.target.value)}
                className="text-xs border border-gray-200 rounded-md px-2 py-1.5 bg-white text-gray-700"
              >
                {AMION_KINDS.map(k => (
                  <option key={k.value} value={k.value}>{k.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* Notes */}
          <Textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Add a note..."
            className="text-xs min-h-[60px] resize-none"
          />
        </>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving || !hasChanges}
          className="text-xs h-7"
        >
          {saving ? 'Saving...' : 'Save Override'}
        </Button>
        {override && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleReset}
            disabled={saving}
            className="text-xs h-7"
          >
            <Undo2 size={12} className="mr-1" />
            Reset
          </Button>
        )}
      </div>
    </div>
  )
}
