import { describe, it, vi, expect } from 'vitest'

describe('ready event', () => {
  it('exits when MEMO_EXIT_AFTER_READY is set', async () => {
    const old = process.env.MEMO_EXIT_AFTER_READY
    process.env.MEMO_EXIT_AFTER_READY = '1'

    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any)
    const timeout = vi.spyOn(globalThis, 'setTimeout')

    try {
      const mod = await import('../src/events/client/ready')
      const handler = (mod as any).default ?? (mod as any)
      await handler.execute({ user: { tag: 'memo#0001' } } as any)

      expect(timeout).toHaveBeenCalledTimes(1)
      const cb = timeout.mock.calls[0]?.[0] as any
      cb()
      expect(exit).toHaveBeenCalledTimes(1)
    } finally {
      exit.mockRestore()
      timeout.mockRestore()
      if (old === undefined) delete process.env.MEMO_EXIT_AFTER_READY
      else process.env.MEMO_EXIT_AFTER_READY = old
    }
  })
})
