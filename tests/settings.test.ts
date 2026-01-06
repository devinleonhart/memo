import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'

describe('settings', () => {
  const saved = { ...process.env }

  beforeEach(() => {
    process.env = { ...saved }
    delete process.env.MEMO_COMMANDS_SCOPE
    delete process.env.MEMO_CLIENT_ID
    delete process.env.MEMO_GUILD_ID
    delete process.env.MEMO_SECRET_KEY
    delete process.env.MEMO_DATA_PATH
    process.env.NODE_ENV = 'test'
    vi.resetModules()
  })

  afterEach(() => {
    process.env = { ...saved }
    vi.resetModules()
  })

  it('defaults commandsScope to guild', async () => {
    const mod = await import('../src/settings')
    expect(mod.default.commandsScope).toBe('guild')
  })

  it('uses global commandsScope when configured', async () => {
    process.env.MEMO_COMMANDS_SCOPE = 'global'
    vi.resetModules()
    const mod = await import('../src/settings')
    expect(mod.default.commandsScope).toBe('global')
  })
})
