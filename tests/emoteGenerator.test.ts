import { describe, expect, it } from 'vitest'
import { buildEmoteUrl, parsePartFilename } from '../src/services/emoteGenerator'

describe('emoteGenerator', () => {
  describe('buildEmoteUrl', () => {
    it('builds the expected query string', () => {
      const url = buildEmoteUrl(
        {
          character: 'clive',
          head: 'normal',
          eyebrows: 'normal',
          eyes: 'lookaway',
          mouth: 'smilewide'
        },
        'https://emote.devleo.me'
      )

      expect(url).toBe(
        'https://emote.devleo.me/emote?character=clive&head=normal&eyebrows=normal&eyes=lookaway&mouth=smilewide'
      )
    })

    it('strips a trailing slash from the base url', () => {
      const url = buildEmoteUrl(
        {
          character: 'dale',
          head: 'normal',
          eyebrows: 'angry',
          eyes: 'wink',
          mouth: 'smile'
        },
        'https://emote.devleo.me/'
      )

      expect(url.startsWith('https://emote.devleo.me/emote?')).toBe(true)
    })
  })

  describe('parsePartFilename', () => {
    it('splits character, key, and name', () => {
      expect(parsePartFilename('clive_eyes_normal.png')).toEqual({
        character: 'clive',
        key: 'eyes',
        name: 'normal'
      })
    })

    it('keeps underscores that belong to the name', () => {
      expect(parsePartFilename('alicia_mouth_smile_open.png')).toEqual({
        character: 'alicia',
        key: 'mouth',
        name: 'smile_open'
      })
    })

    it('returns null for malformed names', () => {
      expect(parsePartFilename('nope.png')).toBeNull()
    })
  })
})
