export interface Todo {
  id: string
  title: string
  notes: string | null
  due_date: string | null      // 'YYYY-MM-DD'
  completed: boolean
  visibility: 'shared' | 'private'
  created_at: string           // ISO timestamp
  created_by: string           // email
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
}
