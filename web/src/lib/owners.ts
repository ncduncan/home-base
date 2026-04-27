// Centralized owner identity. Hardcoded names/emails were pulled out into
// build-time env vars so the source repo doesn't carry PII.

const env = import.meta.env

export const OWNER_LABELS = {
  nat:    (env.VITE_OWNER_NAT_LABEL    as string | undefined) ?? 'A',
  caitie: (env.VITE_OWNER_CAITIE_LABEL as string | undefined) ?? 'B',
} as const

export const OWNER_EMAILS = {
  nat:    ((env.VITE_OWNER_NAT_EMAIL    as string | undefined) ?? '').toLowerCase(),
  caitie: ((env.VITE_OWNER_CAITIE_EMAIL as string | undefined) ?? '').toLowerCase(),
} as const

// Work email Nat's personal calendar invites are sent to so they appear on
// his M365/Outlook calendar. Empty string disables the sync.
export const NAT_WORK_EMAIL = ((env.VITE_NAT_WORK_EMAIL as string | undefined) ?? '').toLowerCase()
