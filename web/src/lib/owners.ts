// Single-source owner config. Reads VITE_ALLOWED_EMAILS, which carries
// owner identity AND the login allowlist in one structured value.
//
// Format: comma-separated rows of `key:label:email[:workEmail]`
//   nat:Nat:user-a@example.com:user-a@work.com,caitie:Caitie:user-b@example.com
//
// Falls back to "A" / "B" labels and an empty allowlist if unset.
//
// Note on secrecy: this value is baked into the client JS bundle at build
// time. The OAuth gate keeps random visitors out, but the values are
// readable to anyone who loads the deployed site. Treat them as
// public-with-friction, not secret.

const env = import.meta.env

export type OwnerKey = 'nat' | 'caitie'

interface OwnerInfo {
  key: OwnerKey
  label: string
  email: string         // primary login email (lowercase)
  workEmail: string     // optional secondary email; '' when absent
}

const FALLBACK: Record<OwnerKey, OwnerInfo> = {
  nat:    { key: 'nat',    label: 'A', email: '', workEmail: '' },
  caitie: { key: 'caitie', label: 'B', email: '', workEmail: '' },
}

function parseOwners(raw: string): Record<OwnerKey, OwnerInfo> {
  const out: Record<OwnerKey, OwnerInfo> = {
    nat:    { ...FALLBACK.nat },
    caitie: { ...FALLBACK.caitie },
  }
  for (const row of raw.split(',').map(s => s.trim()).filter(Boolean)) {
    const [key, label, email, workEmail] = row.split(':').map(s => s.trim())
    if (key !== 'nat' && key !== 'caitie') continue
    if (!label || !email) continue
    out[key] = {
      key,
      label,
      email: email.toLowerCase(),
      workEmail: (workEmail ?? '').toLowerCase(),
    }
  }
  return out
}

const OWNERS = parseOwners((env.VITE_ALLOWED_EMAILS as string | undefined) ?? '')

export const OWNER_LABELS = {
  nat:    OWNERS.nat.label,
  caitie: OWNERS.caitie.label,
} as const

export const OWNER_EMAILS = {
  nat:    OWNERS.nat.email,
  caitie: OWNERS.caitie.email,
} as const

export const NAT_WORK_EMAIL = OWNERS.nat.workEmail

export const ALLOWED_EMAILS: readonly string[] =
  [OWNER_EMAILS.nat, OWNER_EMAILS.caitie].filter(Boolean)
