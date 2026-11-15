import { describe, it, expect } from 'vitest'
import { canSyncGusInvites, type GusSyncGateInputs } from './gus-sync-gate'

const ready: GusSyncGateInputs = {
  eventsLoading: false,
  eventsError: null,
  failedSources: 0,
  gusOverridesReady: true,
  writesPending: false,
  gusCareKey: '2026-11-16:nat:caitie',
}

describe('canSyncGusInvites', () => {
  it('allows the sync when the picture is complete and nothing is in flight', () => {
    expect(canSyncGusInvites(ready)).toBe(true)
  })

  it('waits while a write is still unconfirmed', () => {
    expect(canSyncGusInvites({ ...ready, writesPending: true })).toBe(false)
  })

  it.each([
    ['loading', { eventsLoading: true }],
    ['load error', { eventsError: 'boom' }],
    ['failed source', { failedSources: 1 }],
    ['overrides not landed', { gusOverridesReady: false }],
    ['empty week', { gusCareKey: '' }],
  ] as const)('refuses on degraded data: %s', (_label, patch) => {
    expect(canSyncGusInvites({ ...ready, ...patch })).toBe(false)
  })
})
