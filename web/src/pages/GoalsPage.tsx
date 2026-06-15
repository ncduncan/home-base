import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import Header from '../components/Header'
import GoalsBoard, { type ReorderUpdate } from '../components/goals/GoalsBoard'
import {
  fetchGoals,
  createGoal,
  updateGoal,
  deleteGoal,
  reorderGoals,
  nextGoalStatus,
  type Goal,
  type GoalCategory,
  type GoalStatus,
  type GoalVisibility,
} from '../lib/goals'
import { OWNER_EMAILS } from '../lib/owners'

interface Props {
  session: Session
  tab: 'home' | 'goals'
  onTabChange: (tab: 'home' | 'goals') => void
}

export default function GoalsPage({ session, tab, onTabChange }: Props) {
  const [goals, setGoals] = useState<Goal[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchGoals()
      .then(setGoals)
      .catch(() => {/* fail quiet — empty state */})
      .finally(() => setLoading(false))
  }, [])

  const email = (session.user.email ?? '').toLowerCase()
  const owner: 'nat' | 'caitie' = email === OWNER_EMAILS.nat ? 'nat' : 'caitie'

  const handleCreate = useCallback(async (fields: Omit<Goal, 'id' | 'position'>) => {
    const created = await createGoal(fields)
    setGoals(prev => [...prev, created])
  }, [])

  const handleCycleStatus = useCallback(async (id: string, current: GoalStatus) => {
    const next = nextGoalStatus(current)
    // Optimistic update for instant feedback on click
    setGoals(prev => prev.map(g => g.id === id ? { ...g, status: next } : g))
    try {
      const updated = await updateGoal(id, { status: next })
      setGoals(prev => prev.map(g => g.id === id ? updated : g))
    } catch (e) {
      console.error('Failed to cycle goal status:', e)
      // Roll back on failure
      setGoals(prev => prev.map(g => g.id === id ? { ...g, status: current } : g))
    }
  }, [])

  const handleUpdateText = useCallback(async (id: string, text: string) => {
    const updated = await updateGoal(id, { text })
    setGoals(prev => prev.map(g => g.id === id ? updated : g))
  }, [])

  const handleChangeVisibility = useCallback(async (id: string, visibility: GoalVisibility) => {
    const updated = await updateGoal(id, { visibility })
    setGoals(prev => prev.map(g => g.id === id ? updated : g))
  }, [])

  const handleMoveCategory = useCallback(async (id: string, category: GoalCategory) => {
    const updated = await updateGoal(id, { category })
    setGoals(prev => prev.map(g => g.id === id ? updated : g))
  }, [])

  const handleReorder = useCallback(async (updates: ReorderUpdate[]) => {
    const byId = new Map(updates.map(u => [u.id, u]))
    const snapshot = goals
    // Optimistic: apply new category/position so fetchGoals' sort order is reflected.
    setGoals(prev => {
      const applied = prev.map(g => {
        const u = byId.get(g.id)
        return u ? { ...g, category: u.category, position: u.position } : g
      })
      return [...applied].sort(
        (a, b) =>
          a.category.localeCompare(b.category) || a.position - b.position,
      )
    })
    try {
      await reorderGoals(updates)
    } catch (e) {
      console.error('Failed to reorder goals:', e)
      setGoals(snapshot) // roll back to the pre-drag layout
    }
  }, [goals])

  const handleDelete = useCallback(async (id: string) => {
    await deleteGoal(id)
    setGoals(prev => prev.filter(g => g.id !== id))
  }, [])

  return (
    <div className="min-h-screen bg-hb-page">
      <Header session={session} tab={tab} onTabChange={onTabChange} />
      <main className="px-6 py-6">
        <GoalsBoard
          goals={goals}
          owner={owner}
          createdBy={session.user.email ?? ''}
          loading={loading}
          onCreate={handleCreate}
          onCycleStatus={handleCycleStatus}
          onUpdateText={handleUpdateText}
          onChangeVisibility={handleChangeVisibility}
          onMoveCategory={handleMoveCategory}
          onReorder={handleReorder}
          onDelete={handleDelete}
        />
      </main>
    </div>
  )
}
