import { readdirSync } from 'fs'
import { resolve } from 'path'
import { Client, Collection, GatewayIntentBits } from 'discord.js'
import settings from './settings'

(async () => {
  if (!settings.secretKey) {
    throw new Error('Missing MEMO_SECRET_KEY (bot token). Set it in your .env.')
  }
  if (!settings.clientID) {
    throw new Error('Missing MEMO_CLIENT_ID (application id). Set it in your .env.')
  }
  if (settings.commandsScope === 'guild' && !settings.guildID) {
    throw new Error('MEMO_COMMANDS_SCOPE=guild requires MEMO_GUILD_ID. Set it in your .env.')
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds]
  })

  client.commands = new Collection()

  const functionFolders = readdirSync(resolve(__dirname, './functions'))
  for (const folder of functionFolders) {
    const functionFiles = readdirSync(resolve(__dirname, `./functions/${folder}`))
    for (const file of functionFiles) {
      require(`./functions/${folder}/${file}`)(client)
    }
  }

  await client.handleEvents()
  await client.handleCommands()
  await client.login(settings.secretKey)
})().catch(error => { console.error('Unhandled promise rejection:', error) })
