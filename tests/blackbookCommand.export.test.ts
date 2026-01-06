import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

describe('blackbook command export', () => {
  const savedEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...savedEnv }
    process.env.BLACKBOOK_BASE_URL = 'http://localhost:3000'
    process.env.BLACKBOOK_API_TOKEN = 'token'
    vi.resetModules()
  })

  afterEach(() => {
    process.env = { ...savedEnv }
    vi.resetModules()
  })

  it('exports marked images and reports progress', async () => {
    const processSource = vi.fn().mockResolvedValue('uploaded')

    vi.doMock('../src/services/blackbookImport', async () => {
      const actual: any = await vi.importActual('../src/services/blackbookImport')
      return {
        ...actual,
        processSource
      }
    })

    const now = Date.now()
    const attachments = new Map(
      Array.from({ length: 10 }).map((_, i) => [
        String(i),
        { url: `https://cdn.example/${i}.png`, contentType: 'image/png', name: `${i}.png` }
      ])
    )

    const msg = {
      id: 'm1',
      createdTimestamp: now,
      url: 'https://discord.example/messages/m1',
      attachments,
      content: '',
      reactions: {
        cache: {
          find: (fn: any) => {
            const r = { emoji: { name: 'blackbookit' }, count: 1 }
            return fn(r) ? r : undefined
          }
        }
      }
    } as any

    let calls = 0
    const channel = {
      isTextBased: () => true,
      messages: {
        fetch: async () => {
          calls += 1
          if (calls === 1) {
            return {
              size: 1,
              values: function * () { yield msg },
              last: () => msg
            }
          }
          return { size: 0 }
        }
      }
    } as any

    const editReply = vi.fn().mockResolvedValue(undefined)
    const interaction = {
      deferReply: vi.fn().mockResolvedValue(undefined),
      channel,
      inGuild: () => false,
      options: {
        getSubcommand: () => 'export',
        getString: () => 'U1'
      },
      editReply,
      followUp: vi.fn().mockResolvedValue(undefined)
    } as any

    const mod = await import('../src/commands/blackbook/blackbook')
    const cmd = (mod as any).default ?? (mod as any)
    await cmd.execute(interaction)

    expect(processSource).toHaveBeenCalledTimes(10)
    const joined = editReply.mock.calls.map(c => String(c[0] ?? '')).join('\n')
    expect(joined).toContain('Starting export')
    expect(joined).toContain('Export complete')
  })
})
