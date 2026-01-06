import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendShaIndex, extractUrls, getSpoolDir, loadShaIndex } from '../src/services/blackbookImport'
import { getImageSources, getReactionCount } from '../src/services/blackbookImport'

describe('blackbookImport', () => {
  describe('extractUrls', () => {
    it('extracts and trims punctuation', () => {
      const text = 'a https://example.com/x, b https://example.com/y). c https://example.com/z!'
      expect(extractUrls(text)).toEqual([
        'https://example.com/x',
        'https://example.com/y',
        'https://example.com/z'
      ])
    })

    it('returns empty for empty input', () => {
      expect(extractUrls('')).toEqual([])
    })
  })

  describe('getReactionCount', () => {
    it('returns 0 when no matching reaction exists', () => {
      const msg = {
        reactions: {
          cache: {
            find: () => undefined
          }
        }
      } as any
      expect(getReactionCount(msg, 'blackbookit')).toBe(0)
    })

    it('returns the count for a matching reaction', () => {
      const msg = {
        reactions: {
          cache: {
            find: (fn: any) => {
              const r = { emoji: { name: 'blackbookit' }, count: 3 }
              return fn(r) ? r : undefined
            }
          }
        }
      } as any
      expect(getReactionCount(msg, 'blackbookit')).toBe(3)
    })
  })

  describe('getImageSources', () => {
    it('returns image attachments and URLs', () => {
      const msg = {
        attachments: new Map([
          ['1', { url: 'https://cdn.example/a.png', contentType: 'image/png', name: 'a.png' }],
          ['2', { url: 'https://cdn.example/b.txt', contentType: 'text/plain', name: 'b.txt' }]
        ]),
        content: 'see https://example.com/x.jpg and https://example.com/y)'
      } as any

      const sources = getImageSources(msg)
      expect(sources).toEqual([
        { kind: 'attachment', url: 'https://cdn.example/a.png', filename: 'a.png', contentType: 'image/png' },
        { kind: 'url', url: 'https://example.com/x.jpg' },
        { kind: 'url', url: 'https://example.com/y' }
      ])
    })

    it('includes attachments by filename extension when contentType is missing', () => {
      const msg = {
        attachments: new Map([
          ['1', { url: 'https://cdn.example/a.webp', contentType: null, name: 'a.webp' }]
        ]),
        content: ''
      } as any

      expect(getImageSources(msg)).toEqual([
        { kind: 'attachment', url: 'https://cdn.example/a.webp', filename: 'a.webp', contentType: undefined }
      ])
    })
  })

  describe('getSpoolDir', () => {
    const old = process.env.MEMO_SPOOL_DIR
    beforeEach(() => { delete process.env.MEMO_SPOOL_DIR })
    afterEach(() => {
      if (old === undefined) delete process.env.MEMO_SPOOL_DIR
      else process.env.MEMO_SPOOL_DIR = old
    })

    it('uses MEMO_SPOOL_DIR when set', () => {
      process.env.MEMO_SPOOL_DIR = '/tmp/custom-spool'
      expect(getSpoolDir()).toBe('/tmp/custom-spool')
    })
  })

  describe('sha index', () => {
    it('loads and appends sha256 values', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'memo-test-'))
      try {
        const indexPath = join(dir, 'sha256-index.txt')
        await writeFile(indexPath, 'aaa\nbbb\n\n', 'utf8')

        const set1 = await loadShaIndex(indexPath)
        expect(set1.has('aaa')).toBe(true)
        expect(set1.has('bbb')).toBe(true)

        await appendShaIndex(indexPath, 'ccc')
        const raw = await readFile(indexPath, 'utf8')
        expect(raw.includes('ccc\n')).toBe(true)

        const set2 = await loadShaIndex(indexPath)
        expect(set2.has('ccc')).toBe(true)
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    })

    it('returns empty set when file does not exist', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'memo-test-'))
      try {
        const indexPath = join(dir, 'missing.txt')
        const set = await loadShaIndex(indexPath)
        expect(Array.from(set)).toEqual([])
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    })
  })
})
