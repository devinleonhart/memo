import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchCharacters,
  fetchPartsForCharacter,
  getEmoteBaseUrl,
  validateEmote
} from '../src/services/emoteGenerator'

const config = {
  character: 'clive',
  head: 'normal',
  eyebrows: 'normal',
  eyes: 'glee',
  mouth: 'smile'
}

function answer(body: unknown, init: { ok?: boolean; status?: number; statusText?: string } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    json: async () => body
  }
}

describe('emoteGenerator requests', () => {
  const fetchMock = vi.fn()
  const savedBase = process.env.EMOTE_BASE_URL

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    process.env.EMOTE_BASE_URL = 'http://emote.test/'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (savedBase === undefined) delete process.env.EMOTE_BASE_URL
    else process.env.EMOTE_BASE_URL = savedBase
  })

  it('reads the base address from the environment, without a trailing slash', () => {
    expect(getEmoteBaseUrl()).toBe('http://emote.test')
    delete process.env.EMOTE_BASE_URL
    expect(getEmoteBaseUrl()).toBe('https://emote.devleo.me')
    process.env.EMOTE_BASE_URL = '   '
    expect(getEmoteBaseUrl()).toBe('https://emote.devleo.me')
  })

  it('lists characters, keeping only names', async () => {
    fetchMock.mockResolvedValue(answer(['clive', 7, 'jill']))

    expect(await fetchCharacters()).toEqual(['clive', 'jill'])
    expect(fetchMock.mock.calls[0][0]).toBe('http://emote.test/character')
  })

  it('lists no characters when the answer is not a list', async () => {
    fetchMock.mockResolvedValue(answer({ error: 'x' }))

    expect(await fetchCharacters()).toEqual([])
  })

  it('fails when the generator refuses the request', async () => {
    fetchMock.mockResolvedValue(answer(null, { ok: false, status: 503, statusText: 'Unavailable' }))

    await expect(fetchCharacters()).rejects.toThrow('503 Unavailable')
  })

  it('groups and sorts the parts of a character', async () => {
    fetchMock.mockResolvedValue(
      answer([
        'clive_eyes_normal.png',
        'clive_eyes_glee.png',
        'clive_head_normal.png',
        'clive_mouth_smile_wide.png',
        'unparsable',
        3
      ])
    )

    expect(await fetchPartsForCharacter('Clive')).toEqual({
      eyes: ['glee', 'normal'],
      head: ['normal'],
      mouth: ['smile_wide']
    })
    expect(fetchMock.mock.calls[0][0]).toBe('http://emote.test/part/clive')
  })

  it('has no parts when the answer is not a list', async () => {
    fetchMock.mockResolvedValue(answer('nope'))

    expect(await fetchPartsForCharacter('clive')).toEqual({})
  })

  it('accepts an emote that the generator builds', async () => {
    fetchMock.mockResolvedValue(answer(null))

    expect(await validateEmote(config)).toBeNull()
    expect(fetchMock.mock.calls[0][0]).toContain('http://emote.test/emote?character=clive')
  })

  it('gives the generator’s reason for a refusal, or its status', async () => {
    fetchMock.mockResolvedValue(answer(null, { ok: false, status: 404, statusText: ' Not Found ' }))
    expect(await validateEmote(config)).toBe('Not Found')

    fetchMock.mockResolvedValue(answer(null, { ok: false, status: 500, statusText: '' }))
    expect(await validateEmote(config)).toBe('The emote generator returned status 500.')
  })

  it('gives the error when the generator cannot be reached', async () => {
    fetchMock.mockRejectedValue(new Error('timed out'))
    expect(await validateEmote(config)).toBe('timed out')

    fetchMock.mockRejectedValue('odd')
    expect(await validateEmote(config)).toBe('Could not reach the emote generator.')
  })
})
