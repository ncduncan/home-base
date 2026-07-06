// Asana operations proxy.
//
// Routes ALL Asana reads/writes for the web app through a single server-side
// Personal Access Token (Supabase secret ASANA_PAT). The browser never receives
// the PAT — this replaces the previous design where VITE_ASANA_PAT was baked
// into the public GitHub Pages bundle (an Asana PAT is full-account and cannot
// be scoped, so a public bundle leaked total account access).
//
// Auth: caller passes a Supabase JWT in `Authorization: Bearer ...`; the JWT
// must belong to a user whose email is in ALLOWED_EMAILS. Fail-closed.
//
// This is a Deno port of shared/src/asana.ts (the briefing agent still uses that
// module server-side with its own PAT). Same rationale as calendar-ops: Deno
// edge functions can't import the npm workspace package, so the pure Asana logic
// is ported here. Keep the two in sync when changing task-fetch behavior.
//
// Ops (request body `{op: "...", ...}`):
//   fetchTasks         → AsanaTask[]
//   fetchAllOpenTasks  → AsanaTask[]
//   fetchWorkspaceUsers→ AsanaUser[]
//   fetchMe            → AsanaUser
//   createTask         → {fields:{name,due_on?,assignee?,notes?}} → AsanaTask
//   updateTask         → {gid, fields} → AsanaTask
//   deleteTask         → {gid} → {ok:true}

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ASANA_PAT = Deno.env.get('ASANA_PAT')!
const ASANA_WORKSPACE_GID = Deno.env.get('ASANA_WORKSPACE_GID')!
const ALLOWED_EMAILS = (Deno.env.get('ALLOWED_EMAILS') ?? '')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean)

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ??
  'https://ncduncan.github.io,http://localhost:5173')
  .split(',').map(o => o.trim()).filter(Boolean)

function corsHeaders(origin: string | null): Record<string, string> {
  const allowOrigin = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

// ── Types (mirror shared/src/types.ts) ────────────────────────────────────────

type AsanaTask = {
  gid: string
  name: string
  due_on: string | null
  completed: boolean
  completed_at: string | null
  assignee: { gid: string; name: string } | null
  notes: string | null
  projects: string[]
}
type AsanaUser = { gid: string; name: string; email: string }

// ── Asana client (Deno port of shared/src/asana.ts) ──────────────────────────

const BASE = 'https://app.asana.com/api/1.0'
const TASK_OPT_FIELDS =
  'gid,name,due_on,completed,completed_at,assignee.gid,assignee.name,memberships.project.name,notes'

function withTaskOptFields(path: string): string {
  return path.includes('?') ? `${path}&opt_fields=${TASK_OPT_FIELDS}` : `${path}?opt_fields=${TASK_OPT_FIELDS}`
}

const ymd = (d: Date) => d.toISOString().slice(0, 10)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseTask(raw: any): AsanaTask {
  const projects: string[] = []
  if (Array.isArray(raw.memberships)) {
    for (const m of raw.memberships) {
      if (m.project?.name) projects.push(m.project.name as string)
    }
  }
  return {
    gid: raw.gid,
    name: raw.name,
    due_on: raw.due_on ?? null,
    completed: raw.completed,
    completed_at: raw.completed_at ?? null,
    assignee: raw.assignee ? { gid: raw.assignee.gid, name: raw.assignee.name } : null,
    notes: raw.notes || null,
    projects,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseUsers(json: any): AsanaUser[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (json.data as any[]).map(u => ({ gid: u.gid, name: u.name, email: u.email ?? '' }))
}

function asanaHeaders() {
  return { Authorization: `Bearer ${ASANA_PAT}`, 'Content-Type': 'application/json' }
}
async function asanaGet(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, { headers: asanaHeaders() })
  if (!res.ok) throw new Error(`Asana API error ${res.status}: ${await res.text()}`)
  return res.json()
}
async function asanaPost(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: asanaHeaders(), body: JSON.stringify({ data: body }) })
  if (!res.ok) throw new Error(`Asana API error ${res.status}: ${await res.text()}`)
  return res.json()
}
async function asanaPut(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, { method: 'PUT', headers: asanaHeaders(), body: JSON.stringify({ data: body }) })
  if (!res.ok) throw new Error(`Asana API error ${res.status}: ${await res.text()}`)
  return res.json()
}
async function asanaDelete(path: string): Promise<void> {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE', headers: asanaHeaders() })
  if (!res.ok) throw new Error(`Asana API error ${res.status}: ${await res.text()}`)
}

// Module-scoped memoization (survives across requests on a warm instance).
let _resolved: { workspaceGid: string; users: AsanaUser[] } | null = null

async function listWorkspaceUsers(gid: string): Promise<AsanaUser[]> {
  // /workspaces/{gid}/users does not paginate; a large org 400s ("too large"),
  // which is the signal that gid is the wrong (non-personal) workspace.
  return parseUsers(await asanaGet(`/workspaces/${gid}/users?opt_fields=gid,name,email`))
}

async function resolveWorkspace(): Promise<{ workspaceGid: string; users: AsanaUser[] }> {
  if (_resolved) return _resolved

  try {
    const users = await listWorkspaceUsers(ASANA_WORKSPACE_GID)
    _resolved = { workspaceGid: ASANA_WORKSPACE_GID, users }
    return _resolved
  } catch { /* unusable — fall through to discovery */ }

  let discovered: string[] = []
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ws = await asanaGet('/workspaces?opt_fields=gid') as any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    discovered = (ws.data as any[]).map(w => w.gid as string).filter(g => g !== ASANA_WORKSPACE_GID)
  } catch { /* ignore */ }

  for (const gid of discovered) {
    try {
      const users = await listWorkspaceUsers(gid)
      _resolved = { workspaceGid: gid, users }
      return _resolved
    } catch { continue }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const me = await asanaGet('/users/me?opt_fields=gid,name,email') as any
  _resolved = {
    workspaceGid: ASANA_WORKSPACE_GID,
    users: [{ gid: me.data.gid, name: me.data.name, email: me.data.email ?? '' }],
  }
  return _resolved
}

async function fetchTasksForUser(userGid: string, wsGid: string, completedSince: string): Promise<AsanaTask[]> {
  const all: AsanaTask[] = []
  let offset: string | null = null
  do {
    const params = new URLSearchParams({
      assignee: userGid,
      workspace: wsGid,
      completed_since: completedSince,
      opt_fields: TASK_OPT_FIELDS,
      limit: '100',
    })
    if (offset) params.set('offset', offset)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = await asanaGet(`/tasks?${params.toString()}`) as any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const raw of (json.data as any[])) all.push(parseTask(raw))
    offset = json.next_page?.offset ?? null
  } while (offset)
  return all
}

async function fetchTasks(): Promise<AsanaTask[]> {
  const { workspaceGid: resolvedGid, users } = await resolveWorkspace()
  const userGids = users.map(u => u.gid)
  if (userGids.length === 0) userGids.push('me')

  const cutoff = ymd(new Date(Date.now() + 7 * 86_400_000))
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()

  const seen = new Set<string>()
  const all: AsanaTask[] = []
  for (const gid of userGids) {
    for (const t of await fetchTasksForUser(gid, resolvedGid, sevenDaysAgo)) {
      if (!seen.has(t.gid)) { seen.add(t.gid); all.push(t) }
    }
  }
  return all.filter(t => t.completed || (t.due_on !== null && t.due_on <= cutoff))
}

async function fetchAllOpenTasks(): Promise<AsanaTask[]> {
  const { workspaceGid: resolvedGid, users } = await resolveWorkspace()
  const userGids = users.map(u => u.gid)
  if (userGids.length === 0) userGids.push('me')

  const epoch = new Date(0).toISOString()
  const seen = new Set<string>()
  const all: AsanaTask[] = []
  for (const gid of userGids) {
    for (const t of await fetchTasksForUser(gid, resolvedGid, epoch)) {
      if (!seen.has(t.gid) && !t.completed) { seen.add(t.gid); all.push(t) }
    }
  }
  return all
}

async function fetchWorkspaceUsers(): Promise<AsanaUser[]> {
  return (await resolveWorkspace()).users
}

async function fetchMe(): Promise<AsanaUser> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const me = await asanaGet('/users/me?opt_fields=gid,name,email') as any
  return { gid: me.data.gid, name: me.data.name, email: me.data.email ?? '' }
}

async function createTask(fields: { name: string; due_on?: string; assignee?: string; notes?: string }): Promise<AsanaTask> {
  // Resolve the workspace the same way reads do. In a stateless edge function
  // the instance handling this request may never have run fetchTasks, so we
  // can't trust cached state; using the raw configured secret would post to a
  // wrong/oversized workspace and 400. resolveWorkspace() memoizes per instance.
  const { workspaceGid: wsGid } = await resolveWorkspace()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = await asanaPost(withTaskOptFields('/tasks'), { ...fields, workspace: wsGid }) as any
  return parseTask(json.data)
}

async function updateTask(
  gid: string,
  fields: Partial<{ name: string; due_on: string | null; assignee: string | null; notes: string | null; completed: boolean }>,
): Promise<AsanaTask> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = await asanaPut(withTaskOptFields(`/tasks/${encodeURIComponent(gid)}`), fields) as any
  return parseTask(json.data)
}

async function deleteTask(gid: string): Promise<void> {
  await asanaDelete(`/tasks/${encodeURIComponent(gid)}`)
}

// ── HTTP entry point ──────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get('Origin'))
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: cors })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return Response.json({ error: 'Missing authorization header' }, { status: 401, headers: cors })
  }
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(
    authHeader.replace('Bearer ', '')
  )
  if (authError || !user) {
    return Response.json({ error: 'Invalid token' }, { status: 401, headers: cors })
  }
  const callerEmail = (user.email ?? '').toLowerCase()
  // Fail closed: empty/unset ALLOWED_EMAILS denies everyone.
  if (ALLOWED_EMAILS.length === 0 || !ALLOWED_EMAILS.includes(callerEmail)) {
    return Response.json({ error: 'Not authorized' }, { status: 403, headers: cors })
  }

  let body: { op?: string } & Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400, headers: cors })
  }

  try {
    let result: unknown
    switch (body.op) {
      case 'fetchTasks':          result = await fetchTasks(); break
      case 'fetchAllOpenTasks':   result = await fetchAllOpenTasks(); break
      case 'fetchWorkspaceUsers': result = await fetchWorkspaceUsers(); break
      case 'fetchMe':             result = await fetchMe(); break
      case 'createTask': {
        const fields = body.fields as { name: string; due_on?: string; assignee?: string; notes?: string }
        if (!fields || !fields.name) throw new Error('createTask requires fields.name')
        result = await createTask(fields)
        break
      }
      case 'updateTask': {
        const gid = String(body.gid ?? '')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fields = body.fields as any
        if (!gid || !fields) throw new Error('updateTask requires gid and fields')
        result = await updateTask(gid, fields)
        break
      }
      case 'deleteTask': {
        const gid = String(body.gid ?? '')
        if (!gid) throw new Error('deleteTask requires gid')
        await deleteTask(gid)
        result = { ok: true }
        break
      }
      default:
        return Response.json({ error: `Unknown op: ${body.op}` }, { status: 400, headers: cors })
    }
    return Response.json(result, { headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[asana-ops] op=${body.op} failed:`, message)
    return Response.json({ error: message }, { status: 500, headers: cors })
  }
})
