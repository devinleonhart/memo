import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

type Outcome = 'uploaded' | 'skipped' | 'failed'

// Loads the event with its services replaced, reacts to a message with one image,
// and returns what a test needs to play the rest of the flow.
async function react(
  options: { outcome?: Outcome; universes?: Array<{ name: string; value: string }> } = {}
) {
  const mkdir = vi.fn().mockResolvedValue(undefined)
  const access = vi.fn().mockResolvedValue(undefined)
  vi.doMock('fs', () => ({ promises: { mkdir, access }, constants: { W_OK: 2 } }))

  const processSource = vi.fn().mockResolvedValue(options.outcome ?? 'uploaded')
  const loadShaIndex = vi.fn().mockResolvedValue(new Set<string>())

  vi.doMock('../src/services/blackbookImport', async () => {
    const actual: any = await vi.importActual('../src/services/blackbookImport')
    return {
      ...actual,
      BLACKBOOK_REACTION_EMOJI: 'blackbookit',
      getUniverseChoices: () => options.universes ?? [{ name: 'First World — AA', value: 'AA' }],
      getSpoolDir: vi.fn().mockReturnValue('/tmp/spool'),
      loadShaIndex,
      processSource
    }
  })

  const handlers: Record<string, any> = {}
  const prompt = {
    edit: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    createMessageComponentCollector: vi.fn().mockReturnValue({
      on: (evt: string, cb: any) => {
        handlers[evt] = cb
      }
    })
  } as any

  const user = { bot: false, id: 'u1' } as any
  const reaction = {
    emoji: { name: 'blackbookit' },
    partial: false,
    message: {
      id: 'm1',
      partial: false,
      url: 'https://discord.example/messages/m1',
      attachments: new Map([
        ['1', { url: 'https://cdn.example/a.png', contentType: 'image/png', name: 'a.png' }]
      ]),
      content: '',
      reply: vi.fn().mockResolvedValue(prompt),
      fetch: vi.fn().mockImplementation(async function (this: unknown) {
        return this
      })
    }
  } as any

  const mod = await import('../src/events/client/messageReactionAdd')
  const execute = () => mod.default.execute(reaction, user, {})
  await execute()

  const choice = {
    values: ['AA'],
    deferUpdate: vi.fn().mockResolvedValue(undefined),
    user: { id: 'u1' },
    customId: 'blackbookit:universe:m1:u1'
  } as any

  return { mkdir, loadShaIndex, processSource, handlers, prompt, reaction, choice, execute }
}

describe('messageReactionAdd flow', () => {
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
    vi.useRealTimers()
  })

  it('uploads sources after selection and deletes the in-channel prompt', async () => {
    const flow = await react()

    expect(flow.reaction.message.reply).toHaveBeenCalledTimes(1)
    expect(typeof flow.handlers.collect).toBe('function')

    flow.handlers.collect(flow.choice)

    // The listener starts the upload and returns; wait for its last step.
    await vi.waitFor(() => expect(flow.prompt.delete).toHaveBeenCalledTimes(1))
    expect(flow.mkdir).toHaveBeenCalledTimes(2)
    expect(flow.loadShaIndex).toHaveBeenCalledTimes(1)
    expect(flow.processSource).toHaveBeenCalledTimes(1)
    expect(flow.processSource.mock.calls[0][0]).toMatchObject({
      universeCode: 'AA',
      caption: 'Imported from Discord reaction: https://discord.example/messages/m1'
    })
  })

  it('asks only the person who reacted, with the universes on offer', async () => {
    const flow = await react()

    const asked = flow.reaction.message.reply.mock.calls[0][0]
    expect(asked.components[0].toJSON().components[0].options).toEqual([
      { label: 'First World — AA', value: 'AA' }
    ])

    const { filter } = flow.prompt.createMessageComponentCollector.mock.calls[0][0]
    expect(filter(flow.choice)).toBe(true)
    expect(filter({ ...flow.choice, user: { id: 'someone-else' } })).toBe(false)
  })

  it('does not ask twice while a choice is pending', async () => {
    const flow = await react()

    await flow.execute()

    expect(flow.reaction.message.reply).toHaveBeenCalledTimes(1)
  })

  it('reports the counts and keeps the prompt for a while when an upload fails', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const flow = await react({ outcome: 'failed' })

    flow.handlers.collect(flow.choice)

    await vi.waitFor(() => expect(flow.prompt.edit).toHaveBeenCalledTimes(2))
    const summary = flow.prompt.edit.mock.calls[1][0].content
    expect(summary).toContain('**AA**')
    expect(summary).toContain('Uploaded: 0')
    expect(summary).toContain('Failed: 1')
    expect(flow.prompt.delete).not.toHaveBeenCalled()
    expect(logged).toHaveBeenCalledTimes(1)
    logged.mockRestore()
  })

  it('reports the counts when every image was already uploaded', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const flow = await react({ outcome: 'skipped' })

    flow.handlers.collect(flow.choice)

    await vi.waitFor(() => expect(flow.prompt.edit).toHaveBeenCalledTimes(2))
    expect(flow.prompt.edit.mock.calls[1][0].content).toContain('Skipped: 1')
    logged.mockRestore()
  })

  it.each([
    ['BLACKBOOK_BASE_URL', 'Missing `BLACKBOOK_BASE_URL` in environment.'],
    ['BLACKBOOK_API_TOKEN', 'Missing `BLACKBOOK_API_TOKEN` in environment.']
  ])('says so when %s is not set', async (variable, message) => {
    const flow = await react()
    delete process.env[variable]

    flow.handlers.collect(flow.choice)

    await vi.waitFor(() => expect(flow.prompt.edit).toHaveBeenCalledTimes(2))
    expect(flow.prompt.edit.mock.calls[1][0].content).toBe(message)
    expect(flow.processSource).not.toHaveBeenCalled()
  })

  it('removes the prompt when nobody chose, and may then be asked again', async () => {
    const flow = await react()

    flow.handlers.end({ size: 0 })
    await vi.waitFor(() => expect(flow.prompt.delete).toHaveBeenCalledTimes(1))

    await flow.execute()
    expect(flow.reaction.message.reply).toHaveBeenCalledTimes(2)
  })

  it('leaves the prompt to the upload when a choice was made', async () => {
    const flow = await react()

    flow.handlers.end({ size: 1 })

    expect(flow.prompt.delete).not.toHaveBeenCalled()
  })

  it('logs an upload that throws, and may then be asked again', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const flow = await react()
    flow.loadShaIndex.mockRejectedValue(new Error('disk'))

    flow.handlers.collect(flow.choice)

    await vi.waitFor(() => expect(logged).toHaveBeenCalledTimes(1))
    await flow.execute()
    expect(flow.reaction.message.reply).toHaveBeenCalledTimes(2)
    logged.mockRestore()
  })

  it('says so when no universes are configured', async () => {
    const flow = await react({ universes: [] })

    expect(flow.reaction.message.reply.mock.calls[0][0].content).toContain(
      'No Blackbook universes are configured'
    )
    expect(flow.prompt.createMessageComponentCollector).not.toHaveBeenCalled()
  })

  it('removes a notice after a while', async () => {
    vi.useFakeTimers()
    const flow = await react({ universes: [] })

    expect(flow.prompt.delete).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(10_000)

    expect(flow.prompt.delete).toHaveBeenCalledTimes(1)
  })
})
