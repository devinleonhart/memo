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

  it('DMs the user when no image sources are found', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    const createDM = vi.fn().mockResolvedValue({ send })
    const user = { bot: false, createDM } as any

    const reaction = {
      emoji: { name: 'blackbookit' },
      partial: false,
      message: {
        partial: false,
        attachments: new Map(),
        content: ''
      }
    } as any

    const mod = await import('../src/events/client/messageReactionAdd')
    const handler = (mod as any).default ?? (mod as any)
    await handler.execute(reaction, user, {} as any)

    expect(createDM).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(1)
    const payload = send.mock.calls[0]?.[0]
    expect(String(payload?.content ?? '')).toContain('I didn’t find an image attachment')
  })
})
