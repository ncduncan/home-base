import { describe, it, expect, vi, afterEach } from 'vitest'
import { createAsanaClient } from './asana'

// Minimal fetch double: route by URL substring to a canned { ok, status, body }.
type RouteResult = { ok: boolean; status?: number; body?: unknown }
function mockFetch(route: (url: string) => RouteResult | null) {
  return vi.fn(async (url: string) => {
    const r = route(url)
    if (!r) throw new Error(`unexpected fetch: ${url}`)
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 400),
      text: async () => JSON.stringify(r.body ?? {}),
      json: async () => r.body ?? {},
    } as Response
  })
}

const TOO_LARGE = {
  ok: false,
  status: 400,
  body: { error: 'bad_request', message: 'The result is too large. Unfortunately, this endpoint does not support pagination.' },
}

afterEach(() => vi.unstubAllGlobals())

describe('createAsanaClient — resolveWorkspace', () => {
  it('uses the configured workspace directly and makes NO discovery call on the happy path', async () => {
    const f = mockFetch(url => {
      if (url.includes('/workspaces/PERSONAL/users')) {
        return { ok: true, body: { data: [{ gid: '1', name: 'Nat', email: 'nat@x' }, { gid: '2', name: 'Caitie', email: 'c@x' }] } }
      }
      return null
    })
    vi.stubGlobal('fetch', f)

    const users = await createAsanaClient({ pat: 'p', workspaceGid: 'PERSONAL' }).fetchWorkspaceUsers()

    expect(users.map(u => u.name)).toEqual(['Nat', 'Caitie'])
    // Must not enumerate every workspace the account belongs to.
    expect(f.mock.calls.some(c => String(c[0]).includes('/workspaces?'))).toBe(false)
  })

  it('caches the resolution — repeated calls hit the network once', async () => {
    const f = mockFetch(url =>
      url.includes('/workspaces/PERSONAL/users')
        ? { ok: true, body: { data: [{ gid: '1', name: 'Nat', email: 'nat@x' }] } }
        : null,
    )
    vi.stubGlobal('fetch', f)

    const client = createAsanaClient({ pat: 'p', workspaceGid: 'PERSONAL' })
    await client.fetchWorkspaceUsers()
    await client.fetchWorkspaceUsers()

    const listCalls = f.mock.calls.filter(c => String(c[0]).includes('/workspaces/PERSONAL/users')).length
    expect(listCalls).toBe(1)
  })

  it('falls back to a discovered small workspace when the configured one is too large', async () => {
    const f = mockFetch(url => {
      if (url.includes('/workspaces/BIG/users')) return TOO_LARGE
      if (url.includes('/workspaces?')) return { ok: true, body: { data: [{ gid: 'BIG' }, { gid: 'SMALL' }] } }
      if (url.includes('/workspaces/SMALL/users')) return { ok: true, body: { data: [{ gid: '9', name: 'Nat', email: 'n@x' }] } }
      return null
    })
    vi.stubGlobal('fetch', f)

    const users = await createAsanaClient({ pat: 'p', workspaceGid: 'BIG' }).fetchWorkspaceUsers()
    expect(users.map(u => u.gid)).toEqual(['9'])
  })

  it('final fallback to /users/me when no workspace listing succeeds', async () => {
    const f = mockFetch(url => {
      if (url.includes('/users/me')) return { ok: true, body: { data: { gid: 'me', name: 'Nat', email: 'nat@x' } } }
      if (url.includes('/workspaces?')) return { ok: true, body: { data: [{ gid: 'BIG' }] } }
      if (url.includes('/users')) return TOO_LARGE // any /workspaces/{gid}/users
      return null
    })
    vi.stubGlobal('fetch', f)

    const users = await createAsanaClient({ pat: 'p', workspaceGid: 'BIG' }).fetchWorkspaceUsers()
    expect(users).toEqual([{ gid: 'me', name: 'Nat', email: 'nat@x' }])
  })
})
