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
})
