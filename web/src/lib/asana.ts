import { supabase } from './supabase'
import type { AsanaTask, AsanaUser } from '@home-base/shared/types'

// All Asana reads/writes go through the asana-ops Edge Function, which holds the
// Personal Access Token as a server-side secret. The browser never sees the PAT
// (it used to be baked into the public GitHub Pages bundle via VITE_ASANA_PAT —
// a full-account credential exposed to anyone who viewed source).

type AsanaOpBody = Record<string, unknown> & { op: string }

async function callOp<T = unknown>(body: AsanaOpBody): Promise<T> {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/asana-ops`

  const send = async (jwt: string) =>
    fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  const getJwt = async (force = false) => {
    if (force) {
      const { data } = await supabase.auth.refreshSession()
      return data.session?.access_token ?? null
    }
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token ?? null
  }

  let jwt = await getJwt()
  if (!jwt) throw new Error('asana-ops: no active session')
  let resp = await send(jwt)

  // 401 = Supabase JWT rejected. Force-refresh and retry once.
  if (resp.status === 401) {
    const refreshed = await getJwt(true)
    if (refreshed) {
      jwt = refreshed
      resp = await send(jwt)
    }
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    let detail = text
    try {
      const j = JSON.parse(text) as { error?: string }
      if (j.error) detail = j.error
    } catch { /* not JSON */ }
    throw new Error(`asana-ops ${body.op} failed: ${resp.status} ${detail.slice(0, 200)}`)
  }
  return resp.json() as Promise<T>
}

export const fetchTasks = (): Promise<AsanaTask[]> =>
  callOp<AsanaTask[]>({ op: 'fetchTasks' })

export const fetchAllOpenTasks = (): Promise<AsanaTask[]> =>
  callOp<AsanaTask[]>({ op: 'fetchAllOpenTasks' })

export const fetchWorkspaceUsers = (): Promise<AsanaUser[]> =>
  callOp<AsanaUser[]>({ op: 'fetchWorkspaceUsers' })

export const fetchMe = (): Promise<AsanaUser> =>
  callOp<AsanaUser>({ op: 'fetchMe' })

export const createTask = (
  fields: { name: string; due_on?: string; assignee?: string; notes?: string },
): Promise<AsanaTask> =>
  callOp<AsanaTask>({ op: 'createTask', fields })

export const updateTask = (
  gid: string,
  fields: Partial<{ name: string; due_on: string | null; assignee: string | null; notes: string | null; completed: boolean }>,
): Promise<AsanaTask> =>
  callOp<AsanaTask>({ op: 'updateTask', gid, fields })

export const deleteTask = (gid: string): Promise<void> =>
  callOp<{ ok: true }>({ op: 'deleteTask', gid }).then(() => undefined)
