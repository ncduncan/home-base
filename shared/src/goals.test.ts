import { describe, it, expect, vi } from 'vitest'
import { nextGoalStatus, reorderGoals } from './goals'
import type { SupabaseClient } from '@supabase/supabase-js'

describe('nextGoalStatus', () => {
  it('cycles open → on_track → achieved → open', () => {
    expect(nextGoalStatus('open')).toBe('on_track')
    expect(nextGoalStatus('on_track')).toBe('achieved')
    expect(nextGoalStatus('achieved')).toBe('open')
  })
})

describe('reorderGoals', () => {
  // Minimal Supabase double: record every update payload routed through .eq().
  function mockSupabase() {
    const updates: { fields: Record<string, unknown>; id: unknown }[] = []
    const client = {
      from: () => ({
        update: (fields: Record<string, unknown>) => ({
          eq: (_col: string, id: unknown) => {
            updates.push({ fields, id })
            return Promise.resolve({ error: null })
          },
        }),
      }),
    } as unknown as SupabaseClient
    return { client, updates }
  }

  it('issues one category+position update per entry', async () => {
    const { client, updates } = mockSupabase()
    await reorderGoals(client, [
      { id: 'a', category: 'health', position: 0 },
      { id: 'b', category: 'fun', position: 1 },
    ])
    expect(updates).toHaveLength(2)
    expect(updates[0].id).toBe('a')
    expect(updates[0].fields).toMatchObject({ category: 'health', position: 0 })
    expect(updates[1].fields).toMatchObject({ category: 'fun', position: 1 })
  })

  it('throws if any update returns an error', async () => {
    const client = {
      from: () => ({
        update: () => ({
          eq: () => Promise.resolve({ error: { message: 'boom' } }),
        }),
      }),
    } as unknown as SupabaseClient
    await expect(
      reorderGoals(client, [{ id: 'a', category: 'health', position: 0 }]),
    ).rejects.toThrow(/boom/)
  })

  it('does nothing for an empty update list', async () => {
    const fromSpy = vi.fn()
    const client = { from: fromSpy } as unknown as SupabaseClient
    await reorderGoals(client, [])
    expect(fromSpy).not.toHaveBeenCalled()
  })
})
