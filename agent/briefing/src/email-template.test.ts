import { describe, it, expect } from 'vitest'
import { gusTagsForOwner, renderOwnerCell } from './email-template.ts'
import type { GusResponsibility } from '@home-base/shared'
import type { EventRow } from './briefing-data.ts'

const gus = (dropoff: 'nat' | 'caitie', pickup: 'nat' | 'caitie'): GusResponsibility => ({
  date: '2026-05-25',
  dropoff,
  pickup,
  reason: 'unused',
})

const row = (text: string): EventRow => ({ text, time: '9am – 5pm' })

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

describe('renderOwnerCell', () => {
  it('shows the em-dash only when there are no events and no Gus duty', () => {
    const html = renderOwnerCell([], 'nat', null)
    expect(html).toContain('—')
    expect(html).not.toContain('Gus')
  })

  it('shows the Gus tag (and no em-dash) when the cell has only a Gus duty', () => {
    const html = renderOwnerCell([], 'nat', gus('nat', 'caitie'))
    expect(html).toContain('Gus drop')
    expect(html).not.toContain('—')
  })

  it('renders events and the owner pick tag together', () => {
    const html = renderOwnerCell([row('Dentist')], 'caitie', gus('nat', 'caitie'))
    expect(html).toContain('Dentist')
    expect(html).toContain('Gus pick')
  })

  it('tints the tag with the owner accent color', () => {
    const natHtml = renderOwnerCell([], 'nat', gus('nat', 'nat'))
    expect(natHtml).toContain('#6c87a6') // Nat accent
    const caitieHtml = renderOwnerCell([], 'caitie', gus('caitie', 'caitie'))
    expect(caitieHtml).toContain('#e8c66e') // Caitie accent
  })
})
