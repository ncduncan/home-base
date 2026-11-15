// Optimistic Asana task writes (edit, create). Toggle and delete were already
// optimistic in useTaskMutations; these follow the same shape — change the
// list now, write in the background, undo and toast on failure.
//
// IO is injected so this stays testable without the bundled Asana client.

import type { AsanaTask, AsanaUser } from '@home-base/shared/types'
import { pendingId, isPendingId } from './optimistic'

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

export function createTaskMutations(deps: {
  setTasks: SetTasks
  users: AsanaUser[]
  api: TaskApi
  notify: (message: string) => void
}) {
  const { setTasks, users, api, notify } = deps

  return {
    editTask(gid: string, patch: TaskUpdatePatch): Promise<void> {
      // Not created yet: the row's controls are disabled until it has a gid.
      if (isPendingId(gid)) return Promise.resolve()
      const { assignee_gid, ...rest } = patch
      const fields = Object.keys(rest) as (keyof typeof rest)[]
      // Prior values of only the fields this edit touches, so a rollback can't
      // undo an unrelated change (e.g. a toggle) that landed meanwhile.
      let prior: Partial<AsanaTask> | null = null
      setTasks(prev => prev.map(t => {
        if (t.gid !== gid) return t
        prior ??= {
          ...Object.fromEntries(fields.map(f => [f, t[f]])),
          ...(assignee_gid !== undefined ? { assignee: t.assignee } : {}),
        }
        return { ...t, ...rest, assignee: assigneeFor(users, assignee_gid, t.assignee) }
      }))
      const apiPatch: Parameters<TaskApi['updateTask']>[1] = { ...rest }
      if (assignee_gid !== undefined) apiPatch.assignee = assignee_gid
      return api.updateTask(gid, apiPatch).then(
        () => {},
        err => {
          console.error('Task update failed:', err)
          const restore = prior
          if (restore) setTasks(prev => prev.map(t => (t.gid === gid ? { ...t, ...restore } : t)))
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
