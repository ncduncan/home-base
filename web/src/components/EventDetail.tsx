import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { X, Eye, EyeOff, Pencil, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { CalendarEvent, CalendarOverride, GusOverride } from '../types'

interface Props {
  event: CalendarEvent
  override: CalendarOverride | null
  userEmail: string
  onSave: (override: Omit<CalendarOverride, 'id'>) => Promise<void>
  onDelete: (id: string) => Promise<void>
  // Gus assignment controls — present only when the event is a Gus pickup/dropoff.
  gusOverride?: GusOverride | null
  onSetGusOwner?: (date: string, role: 'pickup' | 'dropoff', owner: 'nat' | 'caitie') => Promise<void>
  onClearGusOwner?: (date: string, role: 'pickup' | 'dropoff') => Promise<void>
  onClose: () => void
}

function gusRoleOf(event: CalendarEvent): 'pickup' | 'dropoff' | null {
  if (event.title === 'Gus pickup') return 'pickup'
  if (event.title === 'Gus dropoff') return 'dropoff'
  return null
}

const AMION_KINDS = [
  { value: 'training', label: 'Training' },
  { value: 'day', label: 'Day Shift' },
  { value: 'night', label: 'Night Shift' },
  { value: '24hr', label: '24Hr' },
  { value: 'backup', label: 'Backup' },
] as const

export default function EventDetail({
  event, override, userEmail, onSave, onDelete,
  gusOverride, onSetGusOwner, onClearGusOwner, onClose,
}: Props) {
  const dateStr = event.start.slice(0, 10)
  const gusRole = gusRoleOf(event)
  const isGus = gusRole !== null && !!onSetGusOwner && !!onClearGusOwner
  const [gusSaving, setGusSaving] = useState(false)

  async function chooseGusOwner(owner: 'nat' | 'caitie' | 'auto') {
    if (!gusRole || !onSetGusOwner || !onClearGusOwner) return
    setGusSaving(true)
    try {
      if (owner === 'auto') await onClearGusOwner(dateStr, gusRole)
      else await onSetGusOwner(dateStr, gusRole, owner)
      onClose()
    } catch (e) {
      console.error('Failed to set Gus owner:', e)
    } finally {
      setGusSaving(false)
    }
  }

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
      // Decide which calendar date the new endTime belongs to:
      // - end > start  → same day (e.g. shortening a 24hr shift to 8a–5p)
      // - end ≤ start  → next day (overnight shift, e.g. 4p → 8a +1)
      // Using the original event's end-date here would lock shortened shifts
      // into a "+1" cross-midnight, which then leaks into Gus availability.
      let endDateStr = dateStr
      if (startTime && endTime && endTime <= startTime) {
        const next = new Date(`${dateStr}T12:00:00`)
        next.setDate(next.getDate() + 1)
        endDateStr = format(next, 'yyyy-MM-dd')
      }
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
          <div className="text-sm font-semibold text-hb-fg truncate">
            {event.is_amion ? (event.amion_kind ?? 'Shift') : event.title}
          </div>
          <div className="text-[11px] text-hb-fg-secondary mt-0.5">
            {event.is_amion ? 'Shift override' : 'Event details'}
          </div>
        </div>
        <button onClick={onClose} className="text-hb-fg-muted hover:text-hb-fg-secondary shrink-0 -mr-1 -mt-1 p-1">
          <X size={14} />
        </button>
      </div>

      {/* Info line */}
      <div className="text-[11px] text-hb-fg-muted break-words">
        {event.calendar_name}
        {event.organizer_email && ` · ${event.organizer_email}`}
        {event.overridden && (
          <span className="ml-1 text-[#a07a18]">(overridden)</span>
        )}
      </div>

      {/* Gus pickup/dropoff owner — manual reassignment that wins over the
          shift-derived algorithm. "Auto" clears the override. */}
      {isGus && (
        <div className="space-y-1.5">
          <div className="text-[11px] text-hb-fg-secondary">
            Who's on {gusRole}?
            {gusOverride && <span className="ml-1 text-[#a07a18]">· set manually</span>}
          </div>
          <div className="flex items-center gap-1">
            {([
              { value: 'caitie', label: 'Caitie' },
              { value: 'nat', label: 'Nat' },
              { value: 'auto', label: 'Auto' },
            ] as const).map(opt => {
              const selected = (gusOverride?.owner ?? 'auto') === opt.value
              return (
                <button
                  key={opt.value}
                  onClick={() => void chooseGusOwner(opt.value)}
                  disabled={gusSaving}
                  className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors disabled:opacity-50 ${
                    selected
                      ? 'bg-hb-fg text-hb-card border-hb-fg'
                      : 'bg-hb-card border-hb-border-soft text-hb-fg-secondary hover:border-hb-fg-faint'
                  }`}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Hide toggle */}
      <button
        onClick={() => setHidden(!hidden)}
        className={`flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
          hidden
            ? 'bg-[#fcf0f0] border-[#f1d8d8] text-[#a14040]'
            : 'bg-hb-card border-hb-border-soft text-hb-fg-secondary hover:border-hb-fg-faint'
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
              <Pencil size={12} className="text-hb-fg-muted shrink-0" />
              <Input
                type="time"
                value={startTime}
                onChange={e => setStartTime(e.target.value)}
                className="w-28 h-8 text-xs"
              />
              <span className="text-hb-fg-muted text-xs">to</span>
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
              <span className="text-xs text-hb-fg-secondary">Shift type:</span>
              <select
                value={amionKind}
                onChange={e => setAmionKind(e.target.value)}
                className="text-xs border border-hb-border-soft rounded-md px-2 py-1.5 bg-hb-card text-hb-fg"
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
