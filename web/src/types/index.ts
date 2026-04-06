export interface AsanaTask {
  gid: string
  name: string
  due_on: string | null      // 'YYYY-MM-DD'
  completed: boolean
  completed_at: string | null  // ISO timestamp
  assignee: { gid: string; name: string } | null
  notes: string | null
  projects: string[]         // project names for display
}

export interface AsanaUser {
  gid: string
  name: string
  email: string
}

export interface CalendarEvent {
  id: string
  title: string
  start: string                // ISO datetime (all-day: date + T00:00:00)
  end: string
  location: string | null
  all_day: boolean
  calendar_name: string
  is_amion: boolean
  amion_kind?: 'training' | 'day' | 'night' | '24hr' | 'backup'
  organizer_email?: string
  overridden?: boolean         // true if a calendar_override was applied
  notes?: string               // from override
}

export interface CalendarOverride {
  id: string
  event_key: string
  event_date: string           // 'YYYY-MM-DD'
  hidden: boolean
  title_override: string | null
  start_override: string | null
  end_override: string | null
  amion_kind_override: string | null
  notes: string | null
  created_by: string
}

export interface GusResponsibility {
  date: string                 // 'YYYY-MM-DD'
  pickup: 'nat' | 'caitie'
  dropoff: 'nat' | 'caitie'
  reason: string               // e.g. "Caitie: Day Shift"
}

export interface WeatherDay {
  date: string        // 'YYYY-MM-DD'
  weatherCode: number // WMO weather interpretation code
  tempMin: number     // °F
  tempMax: number     // °F
}
