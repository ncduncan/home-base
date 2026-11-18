import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import viteConfig from '../vite.config'

// The dashboard is served from the root of its Vercel production domain. These
// checks pin the config that makes deep links, reloads and home-screen icons
// work there, and that nothing from the old GitHub Pages sub-path setup remains.
const WEB = join(import.meta.dirname, '..')
const ROOT = join(WEB, '..')
const read = (p: string) => readFileSync(join(WEB, p), 'utf8')

describe('hosting at the domain root', () => {
  it('builds with base "/"', () => {
    expect((viteConfig as { base?: string }).base).toBe('/')
  })

  it('rewrites every non-file path to index.html so deep links survive a reload', () => {
    const vercel = JSON.parse(read('vercel.json'))
    expect(vercel.rewrites).toEqual([{ source: '/(.*)', destination: '/index.html' }])
  })

  it('installs from the repo root so the @home-base/shared workspace resolves', () => {
    const vercel = JSON.parse(read('vercel.json'))
    expect(vercel.installCommand).toBe('cd .. && npm ci')
    expect(vercel.buildCommand).toBe('npm run build')
    expect(vercel.outputDirectory).toBe('dist')
  })

  it('has no GitHub Pages 404 redirect or ?p= restore script', () => {
    expect(existsSync(join(WEB, 'public/404.html'))).toBe(false)
    const html = read('index.html')
    expect(html).not.toContain('?p=')
    expect(html).not.toContain("get('p')")
    expect(html).not.toContain('/home-base')
  })

  it('links the favicon and apple-touch-icon at the root, and the files exist', () => {
    const html = read('index.html')
    expect(html).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />')
    expect(html).toContain('<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />')
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="Home-Base" />')
    expect(existsSync(join(WEB, 'public/favicon.svg'))).toBe(true)
    expect(existsSync(join(WEB, 'public/apple-touch-icon.png'))).toBe(true)
  })

  it('no longer ships a GitHub Pages deploy workflow', () => {
    expect(existsSync(join(ROOT, '.github/workflows/deploy.yml'))).toBe(false)
  })
})

describe('edge functions', () => {
  for (const fn of ['calendar-ops', 'asana-ops']) {
    it(`${fn} uses the shared CORS module with no github.io default`, () => {
      const src = readFileSync(join(ROOT, `supabase/functions/${fn}/index.ts`), 'utf8')
      expect(src).not.toContain('github.io')
      expect(src).toContain("from './cors.ts'")
      expect(src).toContain("parseAllowedOrigins(Deno.env.get('ALLOWED_ORIGINS'))")
    })
  }
})
