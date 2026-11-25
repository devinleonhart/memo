import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const YEAR_MS = 1000 * 60 * 60 * 24 * 365

function message(id: string, options: { reactions?: number; age?: number; content?: string }) {
  return {
    id,
    createdTimestamp: Date.now() - (options.age ?? 0),
    url: `https://discord.example/messages/${id}`,
    attachments: new Map([
      [id, { url: `https://cdn.example/${id}.png`, contentType: 'image/png', name: `${id}.png` }]
    ]),
    content: options.content ?? '',
    reactions: {
      cache: {
        find: (match: any) => {
          const reaction = { emoji: { name: 'blackbookit' }, count: options.reactions ?? 0 }
          return match(reaction) ? reaction : undefined
        }
      }
    }
  }
}

// A channel whose history comes in the given batches, newest first, then ends.
function channelOf(...batches: Array<Array<ReturnType<typeof message>>>) {
  const fetch = vi.fn(async () => {
    const batch = batches.shift() ?? []
    return { size: batch.length, values: () => batch.values(), last: () => batch.at(-1) }
  })
  return { isTextBased: () => true, messages: { fetch } }
}

function interactionFor(channel: unknown, subcommand: 'count' | 'export') {
  return {
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    channel,
    inGuild: () => false,
    options: { getSubcommand: () => subcommand, getString: () => 'AA' }
  } as any
}

describe('blackbook command over a channel history', () => {
  const savedEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...savedEnv }
    process.env.BLACKBOOK_BASE_URL = 'http://localhost:3000'
    process.env.BLACKBOOK_API_TOKEN = 'token'
    process.env.MEMO_SPOOL_DIR = '/dev/null/spool'
    vi.resetModules()
  })

  afterEach(() => {
    process.env = { ...savedEnv }
    vi.resetModules()
  })

  it('counts reactions across batches and stops at messages older than two years', async () => {
    const channel = channelOf(
      [message('a', { reactions: 2, content: 'see https://example.com/a.png' }), message('b', {})],
      [message('c', { reactions: 1 }), message('old', { reactions: 5, age: 3 * YEAR_MS })],
      [message('never', { reactions: 9 })]
    )
    const interaction = interactionFor(channel, 'count')

    const mod = await import('../src/commands/blackbook/blackbook')
    await mod.default.execute(interaction)

    expect(interaction.editReply).toHaveBeenCalledWith(
      'Reviewed 3 messages. Found 3 :blackbookit: reactions.'
    )
    expect(channel.messages.fetch).toHaveBeenCalledTimes(2)
    expect(channel.messages.fetch.mock.calls[1]).toEqual([{ limit: 100, before: 'b' }])
  })

  it('says so when the token is not set', async () => {
    delete process.env.BLACKBOOK_API_TOKEN
    const interaction = interactionFor(channelOf(), 'export')

    const mod = await import('../src/commands/blackbook/blackbook')
    await mod.default.execute(interaction)

    expect(interaction.editReply).toHaveBeenCalledWith(
      'This bot is missing `BLACKBOOK_API_TOKEN` in its environment.'
    )
  })

  it('exports only marked messages within two years, and counts each outcome', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const processSource = vi
      .fn()
      .mockResolvedValueOnce('uploaded')
      .mockResolvedValueOnce('skipped')
      .mockResolvedValueOnce('failed')
    vi.doMock('../src/services/blackbookImport', async () => {
      const actual: any = await vi.importActual('../src/services/blackbookImport')
      return { ...actual, processSource }
    })

    const channel = channelOf(
      [
        message('a', { reactions: 1 }),
        message('unmarked', {}),
        message('b', { reactions: 1 }),
        message('c', { reactions: 1 }),
        message('old', { reactions: 1, age: 3 * YEAR_MS })
      ],
      [message('never', { reactions: 1 })]
    )
    const interaction = interactionFor(channel, 'export')

    const mod = await import('../src/commands/blackbook/blackbook')
    await mod.default.execute(interaction)

    expect(processSource).toHaveBeenCalledTimes(3)
    expect(processSource.mock.calls[0][0]).toMatchObject({
      universeCode: 'AA',
      caption: 'Imported from Discord: https://discord.example/messages/a'
    })
    const summary = interaction.editReply.mock.calls.at(-1)[0]
    expect(summary).toContain('Export complete for **AA**.')
    expect(summary).toContain('Scanned: 4')
    expect(summary).toContain('Marked messages: 3')
    expect(summary).toContain('Uploaded: 1')
    expect(summary).toContain('Skipped due to deduplication: 1')
    expect(summary).toContain('Failed: 1')
    expect(channel.messages.fetch).toHaveBeenCalledTimes(1)
    logged.mockRestore()
  })
})
