import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readdir, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { processSource } from '../src/services/blackbookImport'

describe('blackbookImport processSource', () => {
  const savedEnv = { ...process.env }
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    process.env = { ...savedEnv }
    vi.restoreAllMocks()
  })

  afterEach(() => {
    process.env = { ...savedEnv }
    globalThis.fetch = originalFetch
  })

  it('downloads and uploads an image and records dedupe', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'memo-spool-'))
    try {
      const calls: Array<{ url: string, init?: any }> = []
      globalThis.fetch = (async (url: any, init?: any) => {
        calls.push({ url: String(url), init })
        if (!init || init.method === undefined) {
          return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } })
        }
        return new Response(JSON.stringify({ image_id: 123 }), { status: 200 })
      }) as any

      const known = new Set<string>()
      const indexPath = join(dir, 'sha256-index.txt')
      const result = await processSource({
        universeCode: 'U1',
        baseUrl: 'http://localhost:3000',
        apiToken: 'token',
        spoolDir: dir,
        indexPath,
        known,
        src: { kind: 'url', url: 'https://cdn.example/img.png' },
        caption: 'cap'
      })

      expect(result).toBe('uploaded')
      expect(calls.length).toBe(2)
      const indexText = await readFile(indexPath, 'utf8')
      expect(indexText.trim().length).toBeGreaterThan(0)
      expect(known.size).toBe(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('retries with http when the first upload looks like an SSL protocol error against an internal URL', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'memo-spool-'))
    try {
      let uploadCount = 0
      const calls: Array<{ url: string, init?: any }> = []

      globalThis.fetch = (async (url: any, init?: any) => {
        calls.push({ url: String(url), init })
        if (!init || init.method === undefined) {
          return new Response(new Uint8Array([9, 9, 9]), { status: 200, headers: { 'content-type': 'image/png' } })
        }

        uploadCount += 1
        if (uploadCount === 1) {
          const err: any = new Error('wrong version number')
          err.code = 'ERR_SSL_PACKET_LENGTH_TOO_LONG'
          throw err
        }

        return new Response(JSON.stringify({ image_id: 7 }), { status: 200 })
      }) as any

      const known = new Set<string>()
      const indexPath = join(dir, 'sha256-index.txt')
      const result = await processSource({
        universeCode: 'U1',
        baseUrl: 'https://blackbook:3000',
        apiToken: 'token',
        spoolDir: dir,
        indexPath,
        known,
        src: { kind: 'url', url: 'https://cdn.example/img.png' },
        caption: 'cap'
      })

      expect(result).toBe('uploaded')
      const uploadUrls = calls.filter(c => c.init?.method === 'POST').map(c => c.url)
      expect(uploadUrls.length).toBe(2)
      expect(uploadUrls[0]).toContain('https://blackbook:3000')
      expect(uploadUrls[1]).toContain('http://blackbook:3000')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('leaves no file behind when the upload fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'memo-spool-'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      globalThis.fetch = (async (_url: any, init?: any) => {
        if (!init || init.method === undefined) {
          return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } })
        }
        return new Response('no', { status: 500 })
      }) as any

      const result = await processSource({
        universeCode: 'U1',
        baseUrl: 'http://localhost:3000',
        apiToken: 'token',
        spoolDir: dir,
        indexPath: join(dir, 'sha256-index.txt'),
        known: new Set<string>(),
        src: { kind: 'url', url: 'https://cdn.example/img.png' },
        caption: 'cap'
      })

      expect(result).toBe('failed')
      expect(await readdir(dir)).toEqual([])
    } finally {
      log.mockRestore()
      await rm(dir, { recursive: true, force: true })
    }
  })
})
