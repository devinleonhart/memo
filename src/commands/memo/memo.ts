import { SlashCommandBuilder } from '@discordjs/builders'
import { type ChatInputCommandInteraction } from 'discord.js'

const commandName = 'memo'

module.exports = {
  data: new SlashCommandBuilder()
    .setName(commandName)
    .setDescription('Say hello.'),

  async execute (interaction: ChatInputCommandInteraction) {
    await interaction.reply('hello')
  }
}
