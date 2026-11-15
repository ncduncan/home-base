// Optimistic Asana task writes (edit, create). Toggle and delete were already
// optimistic in useTaskMutations; these follow the same shape — change the
// list now, write in the background, undo and toast on failure.
//
// IO is injected so this stays testable without the bundled Asana client.

import type { AsanaTask, AsanaUser } from '@home-base/shared/types'
import { pendingId, isPendingId, serialQueue } from './optimistic'

export type TaskUpdatePatch = Partial<Pick<AsanaTask, 'name' | 'notes' | 'due_on'> & { assignee_gid: string | null }>

export interface NewTaskFields { name: string; due_on?: string; assignee?: string }

export interface TaskApi {
  createTask: (fields: NewTaskFields) => Promise<AsanaTask>
  updateTask: (
    gid: string,
    fields: Partial<{ name: string; due_on: string | null; assignee: string | null; notes: string | null; completed: boolean }>,
  ) => Promise<AsanaTask>
}

type SetTasks = (next: AsanaTask[] | ((prev: AsanaTask[]) => AsanaTask[])) => void

function assigneeFor(users: AsanaUser[], gid: string | null | undefined, fallback: AsanaTask['assignee']): AsanaTask['assignee'] {
  if (gid === undefined) return fallback
  if (!gid) return null
  const user = users.find(u => u.gid === gid)
  return user ? { gid, name: user.name } : fallback
}

// Per task+field: the last value the server confirmed, and how many edits to
// that field are still outstanding. A failed edit restores the confirmed value
// only once no later edit to the field is outstanding — restoring "the value
// before this edit" would resurrect an earlier edit that also failed.
// Lives outside the factory (the hook holds one for its lifetime) so it
// survives the factory being re-created when `users` changes.
export interface TaskWriteState {
  fields: Map<string, { confirmed: unknown; outstanding: number }>
  queues: Map<string, <R>(write: () => Promise<R>) => Promise<R>>
}

export function createTaskWriteState(): TaskWriteState {
  return { fields: new Map(), queues: new Map() }
}

export function createTaskMutations(deps: {
  /** Latest committed task list; read synchronously when an edit starts. */
  getTasks: () => AsanaTask[]
  state?: TaskWriteState
  setTasks: SetTasks
  users: AsanaUser[]
  api: TaskApi
  notify: (message: string) => void
}) {
  const { getTasks, setTasks, users, api, notify } = deps
  const { fields: fieldState, queues } = deps.state ?? createTaskWriteState()
  const queueFor = (gid: string) => {
    let q = queues.get(gid)
    if (!q) { q = serialQueue(); queues.set(gid, q) }
    return q
  }

  return {
    editTask(gid: string, patch: TaskUpdatePatch): Promise<void> {
      // Not created yet: the row's controls are disabled until it has a gid.
      if (isPendingId(gid)) return Promise.resolve()
      const current = getTasks().find(t => t.gid === gid)
      if (!current) return Promise.resolve()
      const { assignee_gid, ...rest } = patch
      const next: Partial<AsanaTask> = { ...rest }
      if (assignee_gid !== undefined) next.assignee = assigneeFor(users, assignee_gid, current.assignee)
      const fields = Object.keys(next) as (keyof AsanaTask)[]

      for (const f of fields) {
        const key = `${gid}:${f}`
        const st = fieldState.get(key) ?? { confirmed: current[f], outstanding: 0 }
        st.outstanding += 1
        fieldState.set(key, st)
      }
      setTasks(prev => prev.map(t => (t.gid === gid ? { ...t, ...next } : t)))

      const apiPatch: Parameters<TaskApi['updateTask']>[1] = { ...rest }
      if (assignee_gid !== undefined) apiPatch.assignee = assignee_gid

      const settle = (ok: boolean) => {
        const restore: Partial<AsanaTask> = {}
        for (const f of fields) {
          const key = `${gid}:${f}`
          const st = fieldState.get(key)
          if (!st) continue
          st.outstanding -= 1
          if (ok) st.confirmed = next[f]
          if (st.outstanding === 0) {
            if (!ok) (restore as Record<string, unknown>)[f] = st.confirmed
            fieldState.delete(key)
          }
        }
        if (Object.keys(restore).length > 0) {
          setTasks(prev => prev.map(t => (t.gid === gid ? { ...t, ...restore } : t)))
        }
      }

      // One at a time per task, so the server applies edits in the order made.
      return queueFor(gid)(() => api.updateTask(gid, apiPatch)).then(
        () => settle(true),
        err => {
          console.error('Task update failed:', err)
          settle(false)
          notify("Couldn't update the task")
        },
      )
    },
    createTask(fields: NewTaskFields): Promise<void> {
      const tmp = pendingId()
      const placeholder: AsanaTask = {
        gid: tmp,
        name: fields.name,
        due_on: fields.due_on ?? null,
        completed: false,
        completed_at: null,
        assignee: assigneeFor(users, fields.assignee ?? null, null),
        notes: null,
        projects: [],
      }
      setTasks(prev => [placeholder, ...prev])
      return api.createTask(fields).then(
        created => { setTasks(prev => prev.map(t => (t.gid === tmp ? created : t))) },
        err => {
          console.error('Task create failed:', err)
          setTasks(prev => prev.filter(t => t.gid !== tmp))
          notify("Couldn't add the task")
        },
      )
    },
  }
}
