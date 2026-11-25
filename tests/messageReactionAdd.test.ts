import { describe, expect, it, vi } from 'vitest'

describe('messageReactionAdd event', () => {
  it('does nothing for other emojis', async () => {
    const reaction = {
      emoji: { name: 'other' },
      partial: false
    } as any
    const user = { bot: false } as any

    const mod = await import('../src/events/client/messageReactionAdd')
    const handler = (mod as any).default ?? (mod as any)
    await handler.execute(reaction, user, {} as any)
  })

  it('replies briefly in-channel when no image sources are found', async () => {
    const deleteFn = vi.fn().mockResolvedValue(undefined)
    const reply = vi.fn().mockResolvedValue({ delete: deleteFn })
    const user = { bot: false } as any

    const reaction = {
      emoji: { name: 'blackbookit' },
      partial: false,
      message: {
        partial: false,
        attachments: new Map(),
        content: '',
        reply,
        fetch: vi.fn().mockImplementation(async function (this: unknown) {
          return this
        })
      }
    } as any

    const mod = await import('../src/events/client/messageReactionAdd')
    const handler = (mod as any).default ?? (mod as any)
    await handler.execute(reaction, user, {} as any)

    expect(reply).toHaveBeenCalledTimes(1)
    const payload = reply.mock.calls[0]?.[0]
    expect(String(payload?.content ?? '')).toContain('I didn’t find an image attachment')
  })

  it('ignores reactions from bots', async () => {
    const reaction = { emoji: { name: 'blackbookit' }, partial: true, fetch: vi.fn() } as any

    const mod = await import('../src/events/client/messageReactionAdd')
    await mod.default.execute(reaction, { bot: true }, {})

    expect(reaction.fetch).not.toHaveBeenCalled()
  })

  it('gives up quietly when a partial reaction cannot be fetched', async () => {
    const message = { fetch: vi.fn() }
    const reaction = {
      emoji: { name: 'blackbookit' },
      partial: true,
      fetch: vi.fn().mockRejectedValue(new Error('gone')),
      message
    } as any

    const mod = await import('../src/events/client/messageReactionAdd')
    await mod.default.execute(reaction, { bot: false }, {})

    expect(reaction.fetch).toHaveBeenCalledTimes(1)
    expect(message.fetch).not.toHaveBeenCalled()
  })

  it('says so in the channel when the message cannot be read', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const reply = vi.fn().mockResolvedValue({ delete: vi.fn().mockResolvedValue(undefined) })
    const reaction = {
      emoji: { name: 'blackbookit' },
      partial: false,
      message: { reply, fetch: vi.fn().mockRejectedValue(new Error('forbidden')) }
    } as any

    const mod = await import('../src/events/client/messageReactionAdd')
    await mod.default.execute(reaction, { bot: false }, {})

    expect(reply).toHaveBeenCalledTimes(1)
    expect(reply.mock.calls[0][0].content).toContain('fetch failed')
    expect(reply.mock.calls[0][0].allowedMentions).toEqual({ repliedUser: false, parse: [] })
    logged.mockRestore()
  })

  it('stays silent when neither the message nor a reply is possible', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const reply = vi.fn().mockRejectedValue(new Error('no access'))
    const reaction = {
      emoji: { name: 'blackbookit' },
      partial: false,
      message: { reply, fetch: vi.fn().mockRejectedValue(new Error('forbidden')) }
    } as any

    const mod = await import('../src/events/client/messageReactionAdd')
    await expect(
      mod.default.execute(reaction, { bot: false } as any, {} as any)
    ).resolves.toBeUndefined()
    logged.mockRestore()
  })
})
