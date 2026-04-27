import { createAsanaClient } from '@home-base/shared/asana'

const client = createAsanaClient({
  pat: import.meta.env.VITE_ASANA_PAT as string,
  workspaceGid: import.meta.env.VITE_ASANA_WORKSPACE_GID as string,
})

export const fetchTasks = client.fetchTasks
export const fetchWorkspaceUsers = client.fetchWorkspaceUsers
export const createTask = client.createTask
export const updateTask = client.updateTask
export const deleteTask = client.deleteTask
