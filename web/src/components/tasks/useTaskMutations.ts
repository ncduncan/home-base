import { useCallback } from 'react'
import { createTask, updateTask, deleteTask } from '../../lib/asana'
import type { AsanaTask, AsanaUser } from '../../types'
import type { TaskUpdatePatch } from './TaskRow'

export function useTaskMutations(
  tasks: AsanaTask[],
  setTasks: React.Dispatch<React.SetStateAction<AsanaTask[]>>,
  users: AsanaUser[],
) {
  const addTask = useCallback((task: AsanaTask) => {
    setTasks(prev => [task, ...prev])
  }, [setTasks])

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

  const editTask = useCallback(async (gid: string, patch: TaskUpdatePatch) => {
    const { assignee_gid, ...rest } = patch
    setTasks(prev => prev.map(t => {
      if (t.gid !== gid) return t
      const newAssignee = assignee_gid !== undefined
        ? (assignee_gid
          ? (users.find(u => u.gid === assignee_gid)
            ? { gid: assignee_gid, name: users.find(u => u.gid === assignee_gid)!.name }
            : t.assignee)
          : null)
        : t.assignee
      return { ...t, ...rest, assignee: newAssignee }
    }))
    const apiPatch: Parameters<typeof updateTask>[1] = { ...rest }
    if (assignee_gid !== undefined) apiPatch.assignee = assignee_gid
    await updateTask(gid, apiPatch)
  }, [setTasks, users])

  return { addTask, toggleTask, removeTask, editTask, createTask }
}
