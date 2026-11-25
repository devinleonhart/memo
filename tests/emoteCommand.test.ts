import { beforeEach, describe, expect, it, vi } from 'vitest'

const service = vi.hoisted(() => ({
  validateEmote: vi.fn(),
  fetchCharacters: vi.fn(),
  fetchPartsForCharacter: vi.fn()
}))

vi.mock('../src/services/emoteGenerator', async () => {
  const actual: any = await vi.importActual('../src/services/emoteGenerator')
  return { ...actual, ...service }
})

import emote from '../src/commands/emote/emote'

function commandInteraction(options: Record<string, string | null>) {
  return {
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    options: { getString: (name: string) => options[name] ?? null }
  } as any
}

function autocompleteInteraction(focused: { name: string; value: string }, character?: string) {
  return {
    responded: false,
    respond: vi.fn().mockResolvedValue(undefined),
    options: {
      getFocused: () => focused,
      getString: () => character ?? null
    }
  } as any
}

describe('emote command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is named emote and requires a character', () => {
    const json = emote.data.toJSON()
    expect(json.name).toBe('emote')
    expect(json.options?.[0]).toMatchObject({ name: 'character', required: true })
  })

  it('posts an embed of the emote, with the head defaulting to normal', async () => {
    service.validateEmote.mockResolvedValue(null)
    const interaction = commandInteraction({
      character: 'Clive',
      eyebrows: 'Normal',
      eyes: 'glee',
      mouth: 'smile'
    })

    await emote.execute(interaction)

    expect(interaction.deferReply).toHaveBeenCalledTimes(1)
    expect(service.validateEmote).toHaveBeenCalledWith({
      character: 'clive',
      eyebrows: 'normal',
      eyes: 'glee',
      mouth: 'smile',
      head: 'normal'
    })
    const embed = interaction.editReply.mock.calls[0][0].embeds[0].toJSON()
    expect(embed.title).toBe('Clive')
    expect(embed.description).toContain('head: normal')
    expect(embed.image.url).toContain('character=clive')
    expect(embed.url).toBe(embed.image.url)
  })

  it('reports why an emote could not be built', async () => {
    service.validateEmote.mockResolvedValue('No such mouth')
    const interaction = commandInteraction({
      character: 'clive',
      eyebrows: 'normal',
      eyes: 'glee',
      mouth: 'nope',
      head: 'tall'
    })

    await emote.execute(interaction)

    const reply = interaction.editReply.mock.calls[0][0]
    expect(reply).toContain('**clive**')
    expect(reply).toContain('No such mouth')
  })

  it('suggests characters that contain what was typed', async () => {
    service.fetchCharacters.mockResolvedValue(['clive', 'jill', 'Claire'])
    const interaction = autocompleteInteraction({ name: 'character', value: 'CL' })

    await emote.autocomplete(interaction)

    expect(interaction.respond).toHaveBeenCalledWith([
      { name: 'clive', value: 'clive' },
      { name: 'Claire', value: 'Claire' }
    ])
  })

  it('suggests the parts of the chosen character', async () => {
    service.fetchPartsForCharacter.mockResolvedValue({ eyes: ['glee', 'normal'] })
    const interaction = autocompleteInteraction({ name: 'eyes', value: 'gl' }, 'clive')

    await emote.autocomplete(interaction)

    expect(service.fetchPartsForCharacter).toHaveBeenCalledWith('clive')
    expect(interaction.respond).toHaveBeenCalledWith([{ name: 'glee', value: 'glee' }])
  })

  it('suggests nothing for a part the character lacks, or before a character is chosen', async () => {
    service.fetchPartsForCharacter.mockResolvedValue({})
    const lacking = autocompleteInteraction({ name: 'mouth', value: '' }, 'clive')
    await emote.autocomplete(lacking)
    expect(lacking.respond).toHaveBeenCalledWith([])

    const unchosen = autocompleteInteraction({ name: 'mouth', value: '' })
    await emote.autocomplete(unchosen)
    expect(unchosen.respond).toHaveBeenCalledWith([])
    expect(service.fetchPartsForCharacter).toHaveBeenCalledTimes(1)
  })

  it('offers at most 25 suggestions', async () => {
    service.fetchCharacters.mockResolvedValue(Array.from({ length: 30 }, (_, n) => `c${n}`))
    const interaction = autocompleteInteraction({ name: 'character', value: '' })

    await emote.autocomplete(interaction)

    expect(interaction.respond.mock.calls[0][0]).toHaveLength(25)
  })

  it('answers with nothing when the generator fails', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    service.fetchCharacters.mockRejectedValue(new Error('down'))
    const interaction = autocompleteInteraction({ name: 'character', value: '' })

    await emote.autocomplete(interaction)

    expect(interaction.respond).toHaveBeenCalledWith([])
    expect(logged).toHaveBeenCalledTimes(1)
    logged.mockRestore()
  })

  it('does not answer twice when the failure came after an answer', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    service.fetchCharacters.mockResolvedValue(['clive'])
    const interaction = autocompleteInteraction({ name: 'character', value: '' })
    interaction.respond.mockImplementation(async () => {
      interaction.responded = true
      throw new Error('gone')
    })

    await emote.autocomplete(interaction)

    expect(interaction.respond).toHaveBeenCalledTimes(1)
    logged.mockRestore()
  })
})
