// Single-source owner config. Reads VITE_ALLOWED_EMAILS, which carries
// owner identity AND the login allowlist in one structured value.
//
// Two accepted formats (mix freely within one value):
//   1. Rich:   key:label:email[:workEmail]
//      e.g.   nat:Nat:a@example.com:a@work.com,caitie:Caitie:b@example.com
//   2. Legacy: bare email — adds to the login allowlist; labels fall back
//      to "A" / "B" and email-keyed logic (Gus-care sync, default-owner
//      detection) is disabled.
//
// Note on secrecy: this value is baked into the client JS bundle at build
// time. The OAuth gate keeps random visitors out of the app, but anyone
// who loads the page can read these values from the bundle. Treat them as
// public-with-friction, not secret.

const env = import.meta.env

export type OwnerKey = 'nat' | 'caitie'

interface OwnerInfo {
  key: OwnerKey
  label: string
  email: string
  workEmail: string
}

const FALLBACK: Record<OwnerKey, OwnerInfo> = {
  nat:    { key: 'nat',    label: 'A', email: '', workEmail: '' },
  caitie: { key: 'caitie', label: 'B', email: '', workEmail: '' },
}

interface Parsed {
  owners: Record<OwnerKey, OwnerInfo>
  allowedEmails: string[]
}

function parseOwners(raw: string): Parsed {
  const owners: Record<OwnerKey, OwnerInfo> = {
    nat:    { ...FALLBACK.nat },
    caitie: { ...FALLBACK.caitie },
  }
  const allowed = new Set<string>()

  for (const row of raw.split(',').map(s => s.trim()).filter(Boolean)) {
    if (row.includes(':')) {
      const [key, label, email, workEmail] = row.split(':').map(s => s.trim())
      if ((key === 'nat' || key === 'caitie') && label && email) {
        const lower = email.toLowerCase()
        owners[key] = {
          key,
          label,
          email: lower,
          workEmail: (workEmail ?? '').toLowerCase(),
        }
        allowed.add(lower)
      }
    } else {
      // Legacy bare-email entry — adds to the allowlist only.
      allowed.add(row.toLowerCase())
    }
  }

  return { owners, allowedEmails: [...allowed] }
}

const PARSED = parseOwners((env.VITE_ALLOWED_EMAILS as string | undefined) ?? '')

export const OWNER_LABELS = {
  nat:    PARSED.owners.nat.label,
  caitie: PARSED.owners.caitie.label,
} as const

export const OWNER_EMAILS = {
  nat:    PARSED.owners.nat.email,
  caitie: PARSED.owners.caitie.email,
} as const

export const NAT_WORK_EMAIL = PARSED.owners.nat.workEmail

export const ALLOWED_EMAILS: readonly string[] = PARSED.allowedEmails
