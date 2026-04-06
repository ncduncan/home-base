import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const TRMNL_TOKEN = Deno.env.get('TRMNL_SECRET_TOKEN')!
const OWM_API_KEY = Deno.env.get('OPENWEATHERMAP_API_KEY')!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// ── Types ──────────────────────────────────────────────────────────────────────

interface Todo {
  id: string
  title: string
  due_date: string | null
  created_by: string
}

interface CachedEvent {
  id: string
  title: string
  start_time: string
  end_time: string
  all_day: boolean
  location: string | null
  is_amion: boolean
}

// ── Handler ────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const url = new URL(req.url)

  // Validate secret token
  if (url.searchParams.get('token') !== TRMNL_TOKEN) {
    return new Response('Unauthorized', { status: 401 })
  }

  const now = new Date()
  const weekEnd = new Date(now)
  weekEnd.setDate(weekEnd.getDate() + 7)

  const [todosResult, eventsResult, weatherResult] = await Promise.allSettled([
    supabase
      .from('todos')
      .select('id, title, due_date, created_by')
      .eq('completed', false)
      .eq('visibility', 'shared')
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(12),

    supabase
      .from('calendar_cache')
      .select('id, title, start_time, end_time, all_day, location, is_amion')
      .gte('start_time', now.toISOString())
      .lte('start_time', weekEnd.toISOString())
      .order('start_time', { ascending: true })
      .limit(20),

    fetch(
      `https://api.openweathermap.org/data/2.5/forecast?q=Boston,US&appid=${OWM_API_KEY}&units=imperial&cnt=8`
    ).then(r => r.json()),
  ])

  const todos: Todo[] = todosResult.status === 'fulfilled' ? (todosResult.value.data ?? []) : []
  const events: CachedEvent[] = eventsResult.status === 'fulfilled' ? (eventsResult.value.data ?? []) : []
  const weather = weatherResult.status === 'fulfilled' ? weatherResult.value : null

  return new Response(renderHtml({ todos, events, weather, now }), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
})

// ── HTML renderer ──────────────────────────────────────────────────────────────

function renderHtml({ todos, events, weather, now }: {
  todos: Todo[]
  events: CachedEvent[]
  weather: Record<string, unknown> | null
  now: Date
}): string {
  const dayFmt = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

  const timeFmt = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

  // Group events by day (show max 3 days)
  const dayMap: Record<string, CachedEvent[]> = {}
  for (const e of events) {
    const key = e.start_time.slice(0, 10)
    if (!dayMap[key]) dayMap[key] = []
    dayMap[key].push(e)
  }
  const days = Object.entries(dayMap).slice(0, 3)

  // Weather summary
  let weatherHtml = ''
  const list = (weather as { list?: Array<{ main: { temp_max: number; temp_min: number }; weather: Array<{ description: string }> }> } | null)?.list
  if (list?.length) {
    const slot = list[0]
    const hi = Math.round(slot.main.temp_max)
    const lo = Math.round(slot.main.temp_min)
    const desc = slot.weather[0]?.description ?? ''
    weatherHtml = `<div class="weather">${hi}°/${lo}° &nbsp;·&nbsp; ${esc(desc)}</div>`
  }

  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const todayStr = now.toISOString().slice(0, 10)

  const calHtml = days.length === 0
    ? '<p class="empty">No events this week.</p>'
    : days.map(([dateKey, dayEvents]) => `
      <div class="cal-day">
        <div class="day-label">${dayFmt(dateKey + 'T12:00:00')}</div>
        ${dayEvents.map(e => `
          <div class="cal-event">
            <div class="cal-time">${e.all_day ? 'all day' : timeFmt(e.start_time)}</div>
            <div class="cal-title">${esc(e.title)}${e.is_amion ? '<span class="badge">AMION</span>' : ''}</div>
          </div>`).join('')}
      </div>`).join('')

  const todosHtml = todos.length === 0
    ? '<p class="empty">All clear!</p>'
    : todos.map(t => {
        const overdue = t.due_date && t.due_date < todayStr
        const dueHtml = t.due_date
          ? `<span class="due${overdue ? ' overdue' : ''}">${overdue ? 'overdue' : t.due_date.slice(5)}</span>`
          : ''
        return `<div class="todo"><div class="bullet"></div><div class="todo-text">${esc(t.title)}${dueHtml}</div></div>`
      }).join('')

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  width: 800px; height: 480px; overflow: hidden;
  font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
  background: #fff; color: #000;
  display: flex; flex-direction: column;
}
header {
  padding: 10px 16px 8px;
  border-bottom: 2px solid #000;
  display: flex; justify-content: space-between; align-items: flex-start;
}
h1 { font-size: 22px; font-weight: 700; letter-spacing: -0.5px; }
.date { font-size: 13px; color: #444; margin-top: 1px; }
.weather { font-size: 12px; color: #555; margin-top: 2px; }
.updated { font-size: 11px; color: #999; text-align: right; padding-top: 2px; }
main { display: flex; flex: 1; overflow: hidden; }
.cal {
  width: 460px; border-right: 1px solid #ccc;
  padding: 8px 12px; overflow: hidden;
}
.todos { flex: 1; padding: 8px 12px; overflow: hidden; }
.col-label {
  font-size: 10px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.8px; color: #666; margin-bottom: 5px;
  border-bottom: 1px solid #ddd; padding-bottom: 2px;
}
.cal-day { margin-bottom: 9px; }
.day-label {
  font-size: 10px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.6px; color: #555; margin-bottom: 3px;
}
.cal-event { display: flex; gap: 7px; font-size: 12px; padding: 1px 0; }
.cal-time { width: 54px; color: #777; flex-shrink: 0; font-size: 11px; }
.cal-title { flex: 1; line-height: 1.35; }
.badge {
  font-size: 9px; font-weight: 700; color: #555;
  border: 1px solid #aaa; border-radius: 2px;
  padding: 0 2px; margin-left: 4px; vertical-align: middle;
}
.todo { display: flex; gap: 7px; font-size: 12px; padding: 3px 0; align-items: flex-start; }
.bullet {
  flex-shrink: 0; width: 9px; height: 9px;
  border: 1.5px solid #444; border-radius: 50%; margin-top: 2px;
}
.todo-text { flex: 1; line-height: 1.35; }
.due { font-size: 10px; color: #999; margin-left: 5px; }
.overdue { color: #000; font-weight: 700; }
.empty { font-size: 12px; color: #aaa; padding: 4px 0; }
</style>
</head>
<body>
  <header>
    <div>
      <h1>Home-Base</h1>
      <div class="date">${dateStr}</div>
      ${weatherHtml}
    </div>
    <div class="updated">Updated ${timeStr}</div>
  </header>
  <main>
    <div class="cal">
      <div class="col-label">This Week</div>
      ${calHtml}
    </div>
    <div class="todos">
      <div class="col-label">To Do</div>
      ${todosHtml}
    </div>
  </main>
</body>
</html>`
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
