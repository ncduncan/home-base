import { format, parseISO } from 'date-fns'
import { X, EyeOff, Undo2 } from 'lucide-react'
import type { CalendarEvent, CalendarOverride } from '../types'

interface Props {
  date: string                    // 'YYYY-MM-DD'
  rawEvents: CalendarEvent[]      // un-filtered (so we can show hidden events)
  overrides: CalendarOverride[]
  onUnhide: (overrideId: string) => Promise<void>
  onClose: () => void
}

export default function DayHeaderPanel({
  date, rawEvents, overrides, onUnhide, onClose,
}: Props) {
  const hiddenForDate = overrides.filter(o => o.event_date === date && o.hidden)
  const eventsByKey = new Map(rawEvents.map(e => [`${e.id}|${e.start.slice(0, 10)}`, e]))

  if (hiddenForDate.length === 0) {
    return (
      <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
        <span className="text-[11px] text-gray-400 italic">No hidden events for this day.</span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <X size={14} />
        </button>
      </div>
    )
  }

  return (
    <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
          {format(parseISO(`${date}T00:00:00`), 'EEEE, MMM d')}
        </span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <X size={14} />
        </button>
      </div>

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
    </div>
  )
}
