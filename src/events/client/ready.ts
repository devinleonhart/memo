import { type Client, Events } from 'discord.js'

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client: Client) {
    console.log(`Ready! Logged in as ${client.user?.tag}!`)
    if (process.env.MEMO_EXIT_AFTER_READY === '1') {
      setTimeout(() => process.exit(0), 250)
    }
  }
}
