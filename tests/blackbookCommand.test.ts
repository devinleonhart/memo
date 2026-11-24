import { describe, expect, it, vi } from 'vitest'

describe('blackbook command', () => {
  it('requires a text channel', async () => {
    const editReply = vi.fn().mockResolvedValue(undefined)
    const interaction = {
      deferReply: vi.fn().mockResolvedValue(undefined),
      channel: null,
      editReply
    } as any

    const mod = await import('../src/commands/blackbook/blackbook')
    const cmd = (mod as any).default ?? (mod as any)
    await cmd.execute(interaction)

    expect(editReply).toHaveBeenCalledTimes(1)
  })

  it('reports missing permissions when in a guild channel', async () => {
    const editReply = vi.fn().mockResolvedValue(undefined)
    const interaction = {
      deferReply: vi.fn().mockResolvedValue(undefined),
      channel: {
        isTextBased: () => true,
        permissionsFor: () => ({ has: () => false })
      },
      inGuild: () => true,
      guild: { members: { me: null } },
      client: { user: {} },
      options: { getSubcommand: () => 'count' },
      editReply
    } as any

    const mod = await import('../src/commands/blackbook/blackbook')
    const cmd = (mod as any).default ?? (mod as any)
    await cmd.execute(interaction)

    expect(editReply).toHaveBeenCalledTimes(1)
    expect(String(editReply.mock.calls[0]?.[0] ?? '')).toContain('missing')
  })

  it('runs count against an empty channel history', async () => {
    const editReply = vi.fn().mockResolvedValue(undefined)
    const interaction = {
      deferReply: vi.fn().mockResolvedValue(undefined),
      channel: {
        isTextBased: () => true,
        messages: {
          fetch: async () => ({ size: 0 })
        }
      },
      inGuild: () => false,
      options: { getSubcommand: () => 'count' },
      editReply
    } as any

    const mod = await import('../src/commands/blackbook/blackbook')
    const cmd = (mod as any).default ?? (mod as any)
    await cmd.execute(interaction)

    expect(editReply).toHaveBeenCalledTimes(1)
    expect(String(editReply.mock.calls[0]?.[0] ?? '')).toContain('Reviewed')
  })

  it('reports missing Blackbook env vars on export', async () => {
    const editReply = vi.fn().mockResolvedValue(undefined)
    const interaction = {
      deferReply: vi.fn().mockResolvedValue(undefined),
      channel: {
        isTextBased: () => true,
        messages: {
          fetch: async () => ({ size: 0 })
        }
      },
      inGuild: () => false,
      options: {
        getSubcommand: () => 'export',
        getString: () => 'AA'
      },
      editReply
    } as any

    const oldBase = process.env.BLACKBOOK_BASE_URL
    const oldToken = process.env.BLACKBOOK_API_TOKEN
    delete process.env.BLACKBOOK_BASE_URL
    delete process.env.BLACKBOOK_API_TOKEN

    try {
      const mod = await import('../src/commands/blackbook/blackbook')
      const cmd = (mod as any).default ?? (mod as any)
      await cmd.execute(interaction)

      expect(editReply).toHaveBeenCalledTimes(1)
      expect(String(editReply.mock.calls[0]?.[0] ?? '')).toContain('BLACKBOOK_BASE_URL')
    } finally {
      if (oldBase === undefined) delete process.env.BLACKBOOK_BASE_URL
      else process.env.BLACKBOOK_BASE_URL = oldBase
      if (oldToken === undefined) delete process.env.BLACKBOOK_API_TOKEN
      else process.env.BLACKBOOK_API_TOKEN = oldToken
    }
  })
})
