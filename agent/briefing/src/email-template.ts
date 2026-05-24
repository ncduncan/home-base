import type { BriefingData, DayEntry, EventRow, Owner, TodoEntry } from './briefing-data.ts'
import type { GusResponsibility } from '@home-base/shared'
import type { Narrative } from './narrative.ts'

export type GusTag = 'drop' | 'pick'

/** Which Gus tags belong in `owner`'s column for a day. Order: drop then pick. */
export function gusTagsForOwner(owner: Owner, gus: GusResponsibility | null): GusTag[] {
  if (!gus) return []
  const tags: GusTag[] = []
  if (gus.dropoff === owner) tags.push('drop')
  if (gus.pickup === owner) tags.push('pick')
  return tags
}

const OWNER_COLORS: Record<Owner, { accent: string; fade: string }> = {
  nat: { accent: '#6c87a6', fade: '#f1f5f8' },
  caitie: { accent: '#e8c66e', fade: '#fdf9ee' },
}

function renderGusTag(tag: GusTag, owner: Owner): string {
  const c = OWNER_COLORS[owner]
  const arrow = tag === 'drop' ? '↓' : '↑'
  const label = tag === 'drop' ? 'Gus drop' : 'Gus pick'
  return `
    <div style="margin-top: 4px;">
      <span style="display: inline-block; font-size: 11px; line-height: 1.4; padding: 1px 8px; border-radius: 10px; background: ${c.fade}; border: 1px solid ${c.accent}; color: #1a1a1a;">${arrow} ${label}</span>
    </div>`
}

function renderEventItems(events: EventRow[]): string {
  return events.map(e => `
    <div style="margin-bottom: 4px;">
      <span style="color: #666; font-size: 12px;">${escapeHtml(e.time)}</span>
      <span style="margin-left: 6px;">${escapeHtml(e.text)}</span>
    </div>`).join('')
}

/** A single owner's grid cell: their events plus their Gus tags for the day. */
export function renderOwnerCell(events: EventRow[], owner: Owner, gus: GusResponsibility | null): string {
  const tags = gusTagsForOwner(owner, gus)
  if (events.length === 0 && tags.length === 0) {
    return '<span style="color: #ccc;">—</span>'
  }
  return renderEventItems(events) + tags.map(t => renderGusTag(t, owner)).join('')
}

export function renderEmailHtml(data: BriefingData, narrative: Narrative): string {
  return /* html */ `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Weekly Briefing — ${escapeHtml(data.week.startDate)}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 720px; margin: 0 auto; padding: 24px; color: #1a1a1a; line-height: 1.5;">

  <h1 style="font-size: 22px; margin: 0 0 4px 0;">Weekly Briefing</h1>
  <div style="color: #666; font-size: 14px; margin-bottom: 24px;">${formatDateRange(data.week.startDate, data.week.endDate)}</div>

  <div style="background: #f5f5f0; padding: 16px 20px; border-radius: 8px; margin-bottom: 28px;">
    <p style="margin: 0;">${escapeHtml(narrative.intro)}</p>
  </div>

  ${renderActionItems(narrative.actionItems)}

  <h2 style="font-size: 16px; margin: 28px 0 12px 0; border-bottom: 1px solid #e0e0e0; padding-bottom: 6px;">The week ahead</h2>
  ${renderWeekGrid(data.days)}
  <div style="color: #999; font-size: 12px; margin-top: 8px;">Gus: ↓ drop 7am · ↑ pick 5pm</div>

  <h2 style="font-size: 16px; margin: 28px 0 12px 0; border-bottom: 1px solid #e0e0e0; padding-bottom: 6px;">Tasks this week</h2>
  ${renderTodos(data.todos)}

  <div style="margin-top: 40px; color: #999; font-size: 12px;">
    Sent automatically every Sunday from home-base. Edits to AMION, calendar, or homebase events show up here next week.
  </div>

</body>
</html>`
}

function renderActionItems(items: string[]): string {
  if (items.length === 0) return ''
  return `
  <h2 style="font-size: 16px; margin: 0 0 12px 0; border-bottom: 1px solid #e0e0e0; padding-bottom: 6px;">Heads up</h2>
  <ul style="margin: 0 0 0 0; padding-left: 20px;">
    ${items.map(i => `<li style="margin-bottom: 6px;">${escapeHtml(i)}</li>`).join('')}
  </ul>`
}

function renderWeekGrid(days: DayEntry[]): string {
  return `
  <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
    <thead>
      <tr style="background: #fafafa; text-align: left;">
        <th style="padding: 8px; border-bottom: 1px solid #e0e0e0; width: 110px;">Day</th>
        <th style="padding: 8px; border-bottom: 1px solid #e0e0e0;">Nat</th>
        <th style="padding: 8px; border-bottom: 1px solid #e0e0e0;">Caitie</th>
      </tr>
    </thead>
    <tbody>
      ${days.map(renderDayRow).join('')}
    </tbody>
  </table>`
}

function renderDayRow(day: DayEntry): string {
  const dayBg = day.isWeekend ? '#fafafa' : 'transparent'
  return `
    <tr style="background: ${dayBg};">
      <td style="padding: 8px; border-bottom: 1px solid #f0f0f0; vertical-align: top; color: #333; font-weight: 600;">${escapeHtml(day.label)}</td>
      <td style="padding: 8px; border-bottom: 1px solid #f0f0f0; vertical-align: top;">${renderOwnerCell(day.natEvents, 'nat', day.gus)}</td>
      <td style="padding: 8px; border-bottom: 1px solid #f0f0f0; vertical-align: top;">${renderOwnerCell(day.caitieEvents, 'caitie', day.gus)}</td>
    </tr>`
}

function renderTodos(todos: TodoEntry[]): string {
  if (todos.length === 0) {
    return '<p style="color: #999;">Nothing due this week.</p>'
  }

  const overdue = todos.filter(t => t.bucket === 'overdue')
  const today = todos.filter(t => t.bucket === 'today')
  const thisWeek = todos.filter(t => t.bucket === 'this-week')

  return `
    ${renderTodoSection('Overdue', overdue, '#c33')}
    ${renderTodoSection('Today', today, '#1a1a1a')}
    ${renderTodoSection('This week', thisWeek, '#666')}
  `
}

function renderTodoSection(title: string, todos: TodoEntry[], color: string): string {
  if (todos.length === 0) return ''
  return `
    <div style="margin-bottom: 14px;">
      <div style="font-size: 13px; font-weight: 600; color: ${color}; margin-bottom: 4px;">${escapeHtml(title)}</div>
      ${todos.map(t => `
        <div style="font-size: 14px; margin-bottom: 3px;">
          <span style="color: #999; font-size: 12px; display: inline-block; min-width: 70px;">${formatDueDate(t.dueOn)}</span>
          <span>${escapeHtml(t.title)}</span>
          ${t.owner ? `<span style="color: #999; font-size: 12px; margin-left: 6px;">(${t.owner})</span>` : ''}
          ${t.project ? `<span style="color: #b0b0b0; font-size: 11px; margin-left: 6px;">[${escapeHtml(t.project)}]</span>` : ''}
        </div>
      `).join('')}
    </div>`
}

function formatDueDate(due: string | null): string {
  if (!due) return ''
  const d = new Date(`${due}T12:00:00`)
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function formatDateRange(start: string, end: string): string {
  const s = new Date(`${start}T12:00:00`)
  const e = new Date(`${end}T12:00:00`)
  const sFmt = s.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
  const eFmt = e.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  return `${sFmt} – ${eFmt}`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
