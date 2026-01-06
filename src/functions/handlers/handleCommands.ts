import { readdirSync } from 'fs'
import { resolve } from 'path'
import { type Client, REST, Routes } from 'discord.js'
import settings from '../../settings'

module.exports = (client: Client) => {
  client.handleCommands = async () => {
    const commandFolders = readdirSync(resolve(__dirname, '../../commands'))

    for (const folder of commandFolders) {
      const commandFiles = readdirSync(resolve(__dirname, `../../commands/${folder}`))
      for (const file of commandFiles) {
        const command = require(resolve(__dirname, `../../commands/${folder}/${file}`))
        client.commands.set(command.data.name, command)
      }
    }

    const commands: any[] = []
    for (const folder of commandFolders) {
      const commandFiles = readdirSync(resolve(__dirname, `../../commands/${folder}`))
      for (const file of commandFiles) {
        const command = require(resolve(__dirname, `../../commands/${folder}/${file}`))
        commands.push(command.data.toJSON())
      }
    }

    const rest = new REST().setToken(settings.secretKey)

    try {
      console.log(`Started refreshing ${commands.length} application slash commands.`)

      const route = settings.commandsScope === 'global'
        ? Routes.applicationCommands(settings.clientID)
        : Routes.applicationGuildCommands(settings.clientID, settings.guildID)

      const data = await rest.put(route, { body: commands }) as unknown[]
      console.log(`Successfully reloaded ${data.length} application slash commands.`)
    } catch (error) {
      console.error(error)
    }
  }
}
