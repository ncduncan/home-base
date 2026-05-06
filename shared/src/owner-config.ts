// Single-source owner config parser. Both the web dashboard and the briefing
// agent consume the same `ALLOWED_EMAILS` value (web: VITE_ALLOWED_EMAILS at
// build time, agent: ALLOWED_EMAILS at run time). Format:
//
//   key:label:email[:workEmail]            (rich entry)
//   bareEmail                              (legacy — adds to allowlist only)
//
// Example:
//   nat:Nat:a@gmail.com:a@work.com,caitie:Caitie:b@gmail.com:b@hospital.org
//
// The workEmail field is now used for BOTH owners (Gus pickup/dropoff invites
// route to the responsible person's work email).

export type OwnerKey = 'nat' | 'caitie'

export interface OwnerInfo {
  key: OwnerKey
  label: string
  email: string
  workEmail: string
}

export interface ParsedOwnerConfig {
  owners: Record<OwnerKey, OwnerInfo>
  allowedEmails: string[]
}

const FALLBACK: Record<OwnerKey, OwnerInfo> = {
  nat:    { key: 'nat',    label: 'A', email: '', workEmail: '' },
  caitie: { key: 'caitie', label: 'B', email: '', workEmail: '' },
}

export function parseOwnerConfig(raw: string): ParsedOwnerConfig {
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
      allowed.add(row.toLowerCase())
    }
  }

  return { owners, allowedEmails: [...allowed] }
}
