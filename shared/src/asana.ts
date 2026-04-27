import { format, addDays, subDays } from 'date-fns'
import type { AsanaTask, AsanaUser } from './types.ts'

const BASE = 'https://app.asana.com/api/1.0'

export type AsanaConfig = {
  pat: string
  workspaceGid: string
}

export type AsanaClient = {
  fetchTasks: () => Promise<AsanaTask[]>
  fetchWorkspaceUsers: () => Promise<AsanaUser[]>
  createTask: (fields: { name: string; due_on?: string; assignee?: string; notes?: string }) => Promise<AsanaTask>
  updateTask: (
    gid: string,
    fields: Partial<{ name: string; due_on: string | null; assignee: string | null; notes: string | null; completed: boolean }>,
  ) => Promise<AsanaTask>
  deleteTask: (gid: string) => Promise<void>
}

const TASK_OPT_FIELDS = 'gid,name,due_on,completed,completed_at,assignee.gid,assignee.name,memberships.project.name,notes'

function withTaskOptFields(path: string): string {
  return path.includes('?') ? `${path}&opt_fields=${TASK_OPT_FIELDS}` : `${path}?opt_fields=${TASK_OPT_FIELDS}`
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
    completed_at: (raw.completed_at as string | null) ?? null,
    assignee: raw.assignee
      ? { gid: raw.assignee.gid as string, name: raw.assignee.name as string }
      : null,
    notes: (raw.notes as string | null) || null,
    projects,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseUsers(json: any): AsanaUser[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (json.data as any[]).map(u => ({
    gid: u.gid as string,
    name: u.name as string,
    email: (u.email as string | undefined) ?? '',
  }))
}

export function createAsanaClient(config: AsanaConfig): AsanaClient {
  const { pat, workspaceGid } = config

  // Cached after first successful resolveWorkspace() call — used by createTask
  let _resolvedWorkspaceGid: string | null = null

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

  /**
   * Finds the first workspace where user listing succeeds.
   * Tries the configured workspace first, then discovers others via /workspaces.
   *
   * Critical: the returned workspaceGid MUST be used for task fetching — user GIDs
   * are workspace-scoped, so mixing workspaces causes 404 on the tasks endpoint.
   */
  async function resolveWorkspace(): Promise<{ workspaceGid: string; users: AsanaUser[] }> {
    const candidates: string[] = [workspaceGid]

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ws = await asanaGet('/workspaces?opt_fields=gid') as any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const w of (ws.data as any[])) {
        if (!candidates.includes(w.gid as string)) candidates.push(w.gid as string)
      }
    } catch { /* ignore */ }

    for (const gid of candidates) {
      try {
        const json = await asanaGet(`/users?workspace=${gid}&opt_fields=gid,name,email`)
        _resolvedWorkspaceGid = gid
        return { workspaceGid: gid, users: parseUsers(json) }
      } catch { continue }
    }

    // Final fallback: just the PAT owner; use configured workspace for task fetching
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const me = await asanaGet('/users/me?opt_fields=gid,name,email') as any
    _resolvedWorkspaceGid = workspaceGid
    return {
      workspaceGid,
      users: [{
        gid: me.data.gid as string,
        name: me.data.name as string,
        email: (me.data.email as string | undefined) ?? '',
      }],
    }
  }

  async function fetchTasksForUser(userGid: string, wsGid: string, completedSince: string): Promise<AsanaTask[]> {
    const all: AsanaTask[] = []
    let offset: string | null = null

    do {
      const params = new URLSearchParams({
        assignee: userGid,
        workspace: wsGid,
        completed_since: completedSince,
        opt_fields: 'gid,name,due_on,completed,completed_at,assignee.gid,assignee.name,memberships.project.name,notes',
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

    return all
  }

  /**
   * Fetches tasks for all allowed users.
   * Returns:
   *   - Incomplete tasks with due_on ≤ today+7 (past due, today, this week)
   *   - Tasks completed within the last 7 days (for the "recently completed" section)
   */
  async function fetchTasks(): Promise<AsanaTask[]> {
    const { workspaceGid: resolvedGid, users: allUsers } = await resolveWorkspace()

    const userGids = allUsers.map(u => u.gid)
    if (userGids.length === 0) userGids.push('me')

    const cutoff = format(addDays(new Date(), 7), 'yyyy-MM-dd')
    const sevenDaysAgo = subDays(new Date(), 7).toISOString()

    const seen = new Set<string>()
    const all: AsanaTask[] = []

    for (const gid of userGids) {
      const tasks = await fetchTasksForUser(gid, resolvedGid, sevenDaysAgo)
      for (const t of tasks) {
        if (!seen.has(t.gid)) {
          seen.add(t.gid)
          all.push(t)
        }
      }
    }

    return all.filter(t =>
      t.completed ||
      (!t.completed && t.due_on !== null && t.due_on <= cutoff)
    )
  }

  async function fetchWorkspaceUsers(): Promise<AsanaUser[]> {
    const { users } = await resolveWorkspace()
    return users
  }

  async function createTask(fields: {
    name: string
    due_on?: string
    assignee?: string
    notes?: string
  }): Promise<AsanaTask> {
    const wsGid = _resolvedWorkspaceGid ?? workspaceGid
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = await asanaPost(withTaskOptFields('/tasks'), { ...fields, workspace: wsGid }) as any
    return parseTask(json.data)
  }

  async function updateTask(
    gid: string,
    fields: Partial<{ name: string; due_on: string | null; assignee: string | null; notes: string | null; completed: boolean }>,
  ): Promise<AsanaTask> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = await asanaPut(withTaskOptFields(`/tasks/${gid}`), fields) as any
    return parseTask(json.data)
  }

  async function deleteTask(gid: string): Promise<void> {
    await asanaDelete(`/tasks/${gid}`)
  }

  return {
    fetchTasks,
    fetchWorkspaceUsers,
    createTask,
    updateTask,
    deleteTask,
  }
}
