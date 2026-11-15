// When the dashboard may reconcile Gus invites against Google Calendar.
// Every condition guards against writing from a picture that isn't final —
// see "Gus Invite Sync" invariants in CLAUDE.md.

export interface GusSyncGateInputs {
  eventsLoading: boolean
  eventsError: string | null
  failedSources: number
  gusOverridesReady: boolean
  /** An optimistic write hasn't confirmed yet (lib/optimistic.ts). */
  writesPending: boolean
  gusCareKey: string
}

export function canSyncGusInvites(g: GusSyncGateInputs): boolean {
  // A failed calendar source (or a load error) is indistinguishable from
  // "Caitie has no shifts this week", which would reassign every slot to her
  // and send real cancellations to Nat (invariant 6).
  if (g.eventsLoading || g.eventsError || g.failedSources > 0) return false
  // Overrides that haven't landed: syncing first would email an invite for
  // the algorithmic default and then correct it.
  if (!g.gusOverridesReady) return false
  // An unconfirmed write: if it then failed, its rollback would sync a second
  // time and send real invites/cancellations for a change that never saved.
  if (g.writesPending) return false
  return g.gusCareKey !== ''
}
