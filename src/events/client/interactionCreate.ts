import { type ChatInputCommandInteraction, type Client, Events, type Interaction } from 'discord.js'
import { type BotCommand, type BotEvent } from '../../core/command'

const event: BotEvent = {
  name: Events.InteractionCreate,
  async execute(...args) {
    const [interaction, client] = args as [Interaction, Client]
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName)
      if (!command) return
      await handleExecute(command, interaction, client)
      return
    }

    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName)
      if (!command?.autocomplete) return
      try {
        await command.autocomplete(interaction)
      } catch (error) {
        console.error(error)
      }
    }
  }
}

export default event

async function handleExecute(
  command: BotCommand,
  interaction: ChatInputCommandInteraction,
  client: Client
): Promise<void> {
  try {
    await command.execute(interaction, client)
  } catch (error) {
    console.error(error)
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: 'I’m sorry... something went wrong while handling that request.',
        ephemeral: true
      })
    }
  }
}
