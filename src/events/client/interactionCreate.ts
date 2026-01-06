import { type Client, Events, type Interaction } from 'discord.js'

module.exports = {
  name: Events.InteractionCreate,
  async execute (interaction: Interaction, client: Client) {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName)
      if (!command) return
      await handleExecute(command, interaction)
    }
  }
}

async function handleExecute (instance: any, interaction: any): Promise<void> {
  try {
    await instance.execute(interaction)
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
