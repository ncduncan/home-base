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
}

export interface WeatherDay {
  date: string        // 'YYYY-MM-DD'
  weatherCode: number // WMO weather interpretation code
  tempMin: number     // °F
  tempMax: number     // °F
}
