import { describe, it, expect } from 'vitest'
import { gusTagsForOwner } from './email-template.ts'
import type { GusResponsibility } from '@home-base/shared'

const gus = (dropoff: 'nat' | 'caitie', pickup: 'nat' | 'caitie'): GusResponsibility => ({
  date: '2026-05-25',
  dropoff,
  pickup,
  reason: 'unused',
})

describe('gusTagsForOwner', () => {
  it('gives the dropoff owner a drop tag and the pickup owner a pick tag', () => {
    const g = gus('nat', 'caitie')
    expect(gusTagsForOwner('nat', g)).toEqual(['drop'])
    expect(gusTagsForOwner('caitie', g)).toEqual(['pick'])
  })

  it('stacks drop then pick when one person does both', () => {
    const g = gus('nat', 'nat')
    expect(gusTagsForOwner('nat', g)).toEqual(['drop', 'pick'])
    expect(gusTagsForOwner('caitie', g)).toEqual([])
  })

  it('returns no tags when there is no Gus responsibility (e.g. weekend)', () => {
    expect(gusTagsForOwner('nat', null)).toEqual([])
    expect(gusTagsForOwner('caitie', null)).toEqual([])
  })
})
