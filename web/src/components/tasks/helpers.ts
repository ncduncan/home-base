import { USER_COLORS } from '../../lib/userColors'

export function initials(name: string) {
  return name[0]?.toUpperCase() ?? '?'
}

export function firstWord(name: string) {
  return name.split(' ')[0]
}

const AVATAR_COLORS = [
  'bg-violet-200 text-violet-800',
  'bg-emerald-200 text-emerald-800',
  'bg-rose-200 text-rose-800',
  'bg-orange-200 text-orange-800',
  'bg-teal-200 text-teal-800',
]

export function avatarColor(name: string) {
  const first = name.split(' ')[0].toLowerCase()
  if (first === 'nat') return USER_COLORS.nat.avatar
  if (first.startsWith('cait')) return USER_COLORS.caitie.avatar
  let hash = 0
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}
