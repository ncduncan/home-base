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

describe('createAsanaClient — fetchCompletedTasksInRange', () => {
  it('keeps only tasks completed inside [start, end), once each, across users and pages', async () => {
    const raw = (gid: string, completed: boolean, at: string | null) =>
      ({ gid, name: `t${gid}`, completed, completed_at: at, assignee: { gid: '1', name: 'A' } })
    const f = mockFetch(url => {
      if (url.includes('/workspaces/PERSONAL/users')) {
        return { ok: true, body: { data: [{ gid: '1', name: 'A', email: 'a@x' }, { gid: '2', name: 'B', email: 'b@x' }] } }
      }
      if (url.includes('/tasks?') && url.includes('assignee=1') && !url.includes('offset=')) {
        return { ok: true, body: { data: [raw('a', true, '2026-07-06T12:00:00.000Z'), raw('open', false, null)], next_page: { offset: 'p2' } } }
      }
      if (url.includes('/tasks?') && url.includes('assignee=1') && url.includes('offset=p2')) {
        return { ok: true, body: { data: [raw('late', true, '2026-07-20T00:00:00.000Z')], next_page: null } }
      }
      if (url.includes('/tasks?') && url.includes('assignee=2')) {
        return { ok: true, body: { data: [raw('a', true, '2026-07-06T12:00:00.000Z'), raw('early', true, '2026-06-01T00:00:00.000Z'), raw('b', true, '2026-07-01T00:00:00.000Z')], next_page: null } }
      }
      return null
    })
    vi.stubGlobal('fetch', f)

    const tasks = await createAsanaClient({ pat: 'p', workspaceGid: 'PERSONAL' })
      .fetchCompletedTasksInRange('2026-07-01T00:00:00.000Z', '2026-07-13T00:00:00.000Z')

    expect(tasks.map(t => t.gid).sort()).toEqual(['a', 'b'])
    expect(f.mock.calls.some(([u]) => String(u).includes('completed_since=2026-07-01T00%3A00%3A00.000Z'))).toBe(true)
  })
})
