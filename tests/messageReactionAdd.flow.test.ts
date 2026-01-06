import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

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
  })

  it('uploads sources after selection and deletes the in-channel prompt', async () => {
    const mkdir = vi.fn().mockResolvedValue(undefined)
    const access = vi.fn().mockResolvedValue(undefined)
    vi.doMock('fs', () => ({ promises: { mkdir, access }, constants: { W_OK: 2 } }))

    const processSource = vi.fn().mockResolvedValue('uploaded')
    const loadShaIndex = vi.fn().mockResolvedValue(new Set<string>())
    const getSpoolDir = vi.fn().mockReturnValue('/tmp/spool')

    vi.doMock('../src/services/blackbookImport', async () => {
      const actual: any = await vi.importActual('../src/services/blackbookImport')
      return {
        ...actual,
        BLACKBOOK_REACTION_EMOJI: 'blackbookit',
        BLACKBOOK_UNIVERSE_CHOICES: [{ name: 'Universe One — U1', value: 'U1' }],
        getSpoolDir,
        loadShaIndex,
        processSource
      }
    })

    const prompt = {
      edit: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      createMessageComponentCollector: vi.fn()
    } as any

    const handlers: Record<string, any> = {}
    const collector = {
      on: (evt: string, cb: any) => { handlers[evt] = cb }
    } as any
    prompt.createMessageComponentCollector.mockReturnValue(collector)

    const user = { bot: false, id: 'u1' } as any

    const reaction = {
      emoji: { name: 'blackbookit' },
      partial: false,
      message: {
        id: 'm1',
        partial: false,
        url: 'https://discord.example/messages/m1',
        attachments: new Map([['1', { url: 'https://cdn.example/a.png', contentType: 'image/png', name: 'a.png' }]]),
        content: '',
        reply: vi.fn().mockResolvedValue(prompt),
        fetch: vi.fn().mockImplementation(async function () { return this })
      }
    } as any

    const mod = await import('../src/events/client/messageReactionAdd')
    const handler = (mod as any).default ?? (mod as any)
    await handler.execute(reaction, user, {} as any)

    expect(reaction.message.reply).toHaveBeenCalledTimes(1)
    expect(typeof handlers.collect).toBe('function')

    const i = {
      values: ['U1'],
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      user: { id: 'u1' },
      customId: 'blackbookit:universe:m1:u1'
    } as any

    await handlers.collect(i)

    expect(mkdir).toHaveBeenCalledTimes(2)
    expect(loadShaIndex).toHaveBeenCalledTimes(1)
    expect(processSource).toHaveBeenCalledTimes(1)
    expect(prompt.delete).toHaveBeenCalledTimes(1)
  })
})
