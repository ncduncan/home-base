import { describe, it, expect } from 'vitest'
import { DEFAULT_ALLOWED_ORIGINS, corsHeaders, parseAllowedOrigins } from './cors'

describe('parseAllowedOrigins', () => {
  it('defaults to local dev only when the secret is unset (fails closed in prod)', () => {
    expect(parseAllowedOrigins(undefined)).toEqual(['http://localhost:5173'])
    expect(DEFAULT_ALLOWED_ORIGINS).not.toContain('github.io')
  })

  it('splits and trims a comma-separated secret, dropping blanks', () => {
    expect(parseAllowedOrigins(' https://a.vercel.app , ,http://localhost:5173 ')).toEqual([
      'https://a.vercel.app',
      'http://localhost:5173',
    ])
  })

  it('strips a trailing slash so a pasted URL still matches the browser Origin', () => {
    expect(parseAllowedOrigins('https://a.vercel.app/')).toEqual(['https://a.vercel.app'])
  })

  it('an empty secret allows nothing rather than falling back to the default', () => {
    expect(parseAllowedOrigins('')).toEqual([])
  })
})

describe('corsHeaders', () => {
  const allowed = ['https://home.vercel.app', 'http://localhost:5173']

  it('echoes an allowlisted origin', () => {
    const h = corsHeaders('https://home.vercel.app', allowed)
    expect(h['Access-Control-Allow-Origin']).toBe('https://home.vercel.app')
    expect(h['Vary']).toBe('Origin')
    expect(h['Access-Control-Allow-Methods']).toBe('POST, OPTIONS')
    expect(h['Access-Control-Allow-Headers']).toBe('authorization, content-type')
  })

  it('never allows an origin off the list, e.g. a Vercel preview URL', () => {
    const h = corsHeaders('https://home-git-branch-x.vercel.app', allowed)
    expect(h['Access-Control-Allow-Origin']).toBeUndefined()
    expect(Object.values(h)).not.toContain('https://home-git-branch-x.vercel.app')
  })

  it('never allows the retired GitHub Pages origin under the default list', () => {
    const h = corsHeaders('https://example.github.io', parseAllowedOrigins(undefined))
    expect(h['Access-Control-Allow-Origin']).toBeUndefined()
  })

  it('does not match on prefix or wildcard', () => {
    expect(corsHeaders('https://home.vercel.app.evil.com', allowed)['Access-Control-Allow-Origin']).toBeUndefined()
    expect(corsHeaders('https://evil.vercel.app', ['*.vercel.app'])['Access-Control-Allow-Origin']).toBeUndefined()
  })

  it('handles a missing Origin header and an empty allowlist', () => {
    expect(corsHeaders(null, allowed)['Access-Control-Allow-Origin']).toBeUndefined()
    expect(corsHeaders('https://home.vercel.app', [])['Access-Control-Allow-Origin']).toBeUndefined()
  })
})
