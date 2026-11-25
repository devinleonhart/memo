import { Client, Collection, GatewayIntentBits, Partials, REST, Routes } from 'discord.js'
import settings from './settings'
import { commands, events } from './registry'

export function assertConfig(): void {
  if (!settings.secretKey) {
    throw new Error('Missing MEMO_SECRET_KEY. Set it in your .env as the bot token.')
  }
  if (!settings.clientID) {
    throw new Error('Missing MEMO_CLIENT_ID. Set it in your .env as the application id.')
  }
  if (settings.commandsScope === 'guild' && !settings.guildID) {
    throw new Error('MEMO_COMMANDS_SCOPE=guild requires MEMO_GUILD_ID. Set it in your .env.')
  }
}

export async function registerCommands(): Promise<void> {
  const body = commands.map((command) => command.data.toJSON())
  const rest = new REST().setToken(settings.secretKey)

  console.log(`Started refreshing ${body.length} application slash commands.`)

  const route =
    settings.commandsScope === 'global'
      ? Routes.applicationCommands(settings.clientID)
      : Routes.applicationGuildCommands(settings.clientID, settings.guildID)

  const data = (await rest.put(route, { body })) as unknown[]
  console.log(`Successfully reloaded ${data.length} application slash commands.`)
}

export async function bootstrap(): Promise<Client> {
  assertConfig()

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      // Needed so we can read message content and extract image URLs
      // for the :blackbookit: reaction flow (export also benefits).
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageReactions
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User]
  })

  client.commands = new Collection()
  for (const command of commands) {
    client.commands.set(command.data.name, command)
  }

  for (const event of events) {
    const listener = (...args: unknown[]): void => {
      void Promise.resolve(event.execute(...args, client)).catch((error) => {
        console.error(`Error in event ${event.name}:`, error)
      })
    }
    if (event.once) client.once(event.name, listener)
    else client.on(event.name, listener)
  }

  // Keep the slash commands in sync on boot, but never let a transient Discord
  // error or a registration rate limit block the bot from coming up.
  try {
    await registerCommands()
  } catch (error) {
    console.error(error)
  }
  await client.login(settings.secretKey)

  return client
}
