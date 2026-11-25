import { readdirSync } from 'fs'
import { resolve } from 'path'
import { Client, Collection, GatewayIntentBits, Partials } from 'discord.js'
import settings from './settings'

(async () => {
  if (!settings.secretKey) {
    throw new Error('Missing MEMO_SECRET_KEY. Set it in your .env as the bot token.')
  }
  if (!settings.clientID) {
    throw new Error('Missing MEMO_CLIENT_ID. Set it in your .env as the application id.')
  }
  if (settings.commandsScope === 'guild' && !settings.guildID) {
    throw new Error('MEMO_COMMANDS_SCOPE=guild requires MEMO_GUILD_ID. Set it in your .env.')
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      // Needed so we can read message content and extract image URLs
      // for the :blackbookit: reaction flow (export also benefits).
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageReactions
    ],
    partials: [
      Partials.Message,
      Partials.Channel,
      Partials.Reaction,
      Partials.User
    ]
  })

  client.commands = new Collection()

  const functionFolders = readdirSync(resolve(__dirname, './functions'))
  for (const folder of functionFolders) {
    const functionFiles = readdirSync(resolve(__dirname, `./functions/${folder}`))
    for (const file of functionFiles) {
      require(`./functions/${folder}/${file}`)(client)
    }
  }

  client.handleEvents()
  await client.handleCommands()
  await client.login(settings.secretKey)
})().catch(error => { console.error('Unhandled promise rejection:', error) })
