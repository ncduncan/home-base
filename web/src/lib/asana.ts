import { format, addDays } from 'date-fns'
import type { AsanaTask, AsanaUser } from '../types'

const BASE = 'https://app.asana.com/api/1.0'
const pat = import.meta.env.VITE_ASANA_PAT as string
const workspaceGid = import.meta.env.VITE_ASANA_WORKSPACE_GID as string

function headers() {
  return {
    Authorization: `Bearer ${pat}`,
    'Content-Type': 'application/json',
  }
}

async function asanaGet(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, { headers: headers() })
  if (!res.ok) throw new Error(`Asana API error ${res.status}: ${await res.text()}`)
  return res.json()
}

async function asanaPost(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ data: body }),
  })
  if (!res.ok) throw new Error(`Asana API error ${res.status}: ${await res.text()}`)
  return res.json()
}

async function asanaPut(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify({ data: body }),
  })
  if (!res.ok) throw new Error(`Asana API error ${res.status}: ${await res.text()}`)
  return res.json()
}

async function asanaDelete(path: string): Promise<void> {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE', headers: headers() })
  if (!res.ok) throw new Error(`Asana API error ${res.status}: ${await res.text()}`)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseTask(raw: any): AsanaTask {
  const projects: string[] = []
  if (Array.isArray(raw.memberships)) {
    for (const m of raw.memberships) {
      if (m.project?.name) projects.push(m.project.name as string)
    }
  }
  return {
    gid: raw.gid as string,
    name: raw.name as string,
    due_on: (raw.due_on as string | null) ?? null,
    completed: raw.completed as boolean,
    assignee: raw.assignee
      ? { gid: raw.assignee.gid as string, name: raw.assignee.name as string }
      : null,
    notes: (raw.notes as string | null) || null,
    projects,
  }
}

export async function fetchMyTasks(): Promise<AsanaTask[]> {
  const cutoff = format(addDays(new Date(), 7), 'yyyy-MM-dd')
  const all: AsanaTask[] = []
  let offset: string | null = null

  do {
    const params = new URLSearchParams({
      assignee: 'me',
      workspace: workspaceGid,
      completed_since: 'now',
      opt_fields: 'gid,name,due_on,completed,assignee.gid,assignee.name,memberships.project.name,notes',
      limit: '100',
    })
    if (offset) params.set('offset', offset)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = await asanaGet(`/tasks?${params.toString()}`) as any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const raw of (json.data as any[])) {
      all.push(parseTask(raw))
    }
    offset = json.next_page?.offset ?? null
  } while (offset)

  // Filter: only tasks with a due date on or before today+7
  return all.filter(t => t.due_on !== null && t.due_on <= cutoff)
}

export async function fetchWorkspaceUsers(): Promise<AsanaUser[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = await asanaGet(`/workspaces/${workspaceGid}/users?opt_fields=gid,name,email`) as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (json.data as any[]).map(u => ({
    gid: u.gid as string,
    name: u.name as string,
    email: (u.email as string | undefined) ?? '',
  }))
}

export async function createTask(fields: {
  name: string
  due_on?: string
  assignee?: string
  notes?: string
}): Promise<AsanaTask> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = await asanaPost('/tasks', { ...fields, workspace: workspaceGid }) as any
  return parseTask(json.data)
}

export async function updateTask(
  gid: string,
  fields: Partial<{ name: string; due_on: string | null; assignee: string | null; notes: string | null; completed: boolean }>,
): Promise<AsanaTask> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = await asanaPut(`/tasks/${gid}`, fields) as any
  return parseTask(json.data)
}

export async function deleteTask(gid: string): Promise<void> {
  await asanaDelete(`/tasks/${gid}`)
}
