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

  it('does not reply again when the failing command had already deferred', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const execute = vi.fn().mockRejectedValue(new Error('boom'))
    const client = { commands: new Map([['blackbook', { execute }]]) } as any
    const reply = vi.fn()
    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'blackbook',
      replied: false,
      deferred: true,
      reply
    } as any

    const mod = await import('../src/events/client/interactionCreate')
    await mod.default.execute(interaction, client)

    expect(reply).not.toHaveBeenCalled()
    logged.mockRestore()
  })

  it('ignores a command it does not know', async () => {
    const client = { commands: new Map() } as any
    const chat = { isChatInputCommand: () => true, commandName: 'gone' } as any
    const typing = {
      isChatInputCommand: () => false,
      isAutocomplete: () => true,
      commandName: 'gone'
    } as any

    const mod = await import('../src/events/client/interactionCreate')
    await expect(mod.default.execute(chat, client)).resolves.toBeUndefined()
    await expect(mod.default.execute(typing, client)).resolves.toBeUndefined()
  })

  it('passes autocomplete to the command, and survives its failure', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const autocomplete = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce('down')
    const client = {
      commands: new Map<string, any>([
        ['emote', { autocomplete }],
        ['blackbook', {}]
      ])
    } as any
    const typing = (commandName: string) =>
      ({ isChatInputCommand: () => false, isAutocomplete: () => true, commandName }) as any

    const mod = await import('../src/events/client/interactionCreate')
    await mod.default.execute(typing('emote'), client)
    await mod.default.execute(typing('emote'), client)
    await mod.default.execute(typing('blackbook'), client)

    expect(autocomplete).toHaveBeenCalledTimes(2)
    expect(logged).toHaveBeenCalledTimes(1)
    logged.mockRestore()
  })

  it('ignores other interactions', async () => {
    const other = { isChatInputCommand: () => false, isAutocomplete: () => false } as any

    const mod = await import('../src/events/client/interactionCreate')
    await expect(mod.default.execute(other, { commands: new Map() })).resolves.toBeUndefined()
  })
})
