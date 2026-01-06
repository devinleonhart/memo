import { describe, expect, it, vi } from 'vitest'

describe('interactionCreate event', () => {
  it('executes the matching command for chat input commands', async () => {
    const execute = vi.fn().mockResolvedValue(undefined)
    const client = { commands: new Map([['blackbook', { execute }]]) } as any

    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'blackbook'
    } as any

    const mod = await import('../src/events/client/interactionCreate')
    const handler = (mod as any).default ?? (mod as any)
    await handler.execute(interaction, client)

    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('replies ephemerally if the command throws and the interaction is not yet replied', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('boom'))
    const client = { commands: new Map([['blackbook', { execute }]]) } as any

    const reply = vi.fn().mockResolvedValue(undefined)
    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'blackbook',
      replied: false,
      deferred: false,
      reply
    } as any

    const mod = await import('../src/events/client/interactionCreate')
    const handler = (mod as any).default ?? (mod as any)
    await handler.execute(interaction, client)

    expect(reply).toHaveBeenCalledTimes(1)
    const payload = reply.mock.calls[0]?.[0]
    expect(payload?.ephemeral).toBe(true)
    expect(String(payload?.content ?? '').toLowerCase()).toContain('something went wrong')
  })
})
