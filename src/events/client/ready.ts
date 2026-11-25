import { type Client, Events } from 'discord.js'
import { type BotEvent } from '../../core/command'

const event: BotEvent = {
  name: Events.ClientReady,
  once: true,
  execute(...args) {
    const [client] = args as [Client]
    console.log(`Ready! Logged in as ${client.user?.tag}!`)
    if (process.env.MEMO_EXIT_AFTER_READY === '1') {
      setTimeout(() => process.exit(0), 250)
    }
  }
}

export default event
