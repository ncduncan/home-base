import { useCallback, useMemo } from 'react'
import { createTask, updateTask, deleteTask } from '../../lib/asana'
import { createTaskMutations } from '../../lib/task-mutations'
import { useToast } from '../../lib/toast'
import type { AsanaTask, AsanaUser } from '../../types'

export function useTaskMutations(
  tasks: AsanaTask[],
  setTasks: React.Dispatch<React.SetStateAction<AsanaTask[]>>,
  users: AsanaUser[],
) {
  const notify = useToast()

  // Edit and create are optimistic with rollback + toast (lib/task-mutations).
  const { editTask, createTask: createTaskOptimistic } = useMemo(
    () => createTaskMutations({ setTasks, users, api: { createTask, updateTask }, notify }),
    [setTasks, users, notify],
  )

  const toggleTask = useCallback(async (gid: string, completed: boolean) => {
    setTasks(prev => prev.map(t => t.gid === gid ? { ...t, completed } : t))
    try {
      await updateTask(gid, { completed })
    } catch {
      setTasks(prev => prev.map(t => t.gid === gid ? { ...t, completed: !completed } : t))
    }
  }, [setTasks])

  const removeTask = useCallback(async (gid: string) => {
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
