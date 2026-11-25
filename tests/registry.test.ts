import { describe, expect, it } from 'vitest'
import { commands, events } from '../src/registry'

describe('registry', () => {
  it('lists each command once, by its name', () => {
    const names = commands.map((command) => command.data.name)
    expect(names.sort()).toEqual(['blackbook', 'emote'])
  })

  it('gives every command something to run and a definition Discord accepts', () => {
    for (const command of commands) {
      expect(typeof command.execute).toBe('function')
      expect(command.data.toJSON()).toMatchObject({ name: command.data.name })
    }
  })

  it('lists the events the bot listens to', () => {
    const names = events.map((event) => event.name)
    expect(names.sort()).toEqual(['clientReady', 'interactionCreate', 'messageReactionAdd'])
    expect(events.find((event) => event.name === 'clientReady')?.once).toBe(true)
  })
})
