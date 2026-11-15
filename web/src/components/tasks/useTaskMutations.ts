import { useCallback, useMemo, useState } from 'react'
import { createTask, updateTask, deleteTask } from '../../lib/asana'
import { createTaskMutations, createTaskWriteState } from '../../lib/task-mutations'
import { isPendingId } from '../../lib/optimistic'
import { useToast } from '../../lib/toast'
import type { AsanaTask, AsanaUser } from '../../types'

export function useTaskMutations(
  tasks: AsanaTask[],
  setTasks: React.Dispatch<React.SetStateAction<AsanaTask[]>>,
  users: AsanaUser[],
) {
  const notify = useToast()
  const [writeState] = useState(createTaskWriteState)
  // Edit and create are optimistic with rollback + toast (lib/task-mutations).
  // Re-created when `tasks` changes; the write state it shares is stable.
  const { editTask, createTask: createTaskOptimistic } = useMemo(
    () => createTaskMutations({
      getTasks: () => tasks,
      state: writeState,
      setTasks,
      users,
      api: { createTask, updateTask },
      notify,
    }),
    [tasks, setTasks, users, notify, writeState],
  )

  // A just-added task has no Asana gid yet; its controls are disabled, and
  // these guard against any other caller.
  const toggleTask = useCallback(async (gid: string, completed: boolean) => {
    if (isPendingId(gid)) return
    setTasks(prev => prev.map(t => t.gid === gid ? { ...t, completed } : t))
    try {
      await updateTask(gid, { completed })
    } catch {
      setTasks(prev => prev.map(t => t.gid === gid ? { ...t, completed: !completed } : t))
    }
  }, [setTasks])

  const removeTask = useCallback(async (gid: string) => {
    if (isPendingId(gid)) return
    const backup = tasks.find(t => t.gid === gid)
    setTasks(prev => prev.filter(t => t.gid !== gid))
    try {
      await deleteTask(gid)
    } catch {
      if (backup) setTasks(prev => [backup, ...prev])
    }
  }, [tasks, setTasks])

  return { toggleTask, removeTask, editTask, createTask: createTaskOptimistic }
}
