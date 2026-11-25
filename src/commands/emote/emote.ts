import { SlashCommandBuilder, EmbedBuilder } from '@discordjs/builders'
import { type AutocompleteInteraction, type ChatInputCommandInteraction } from 'discord.js'
import { type BotCommand } from '../../core/command'
import {
  buildEmoteUrl,
  fetchCharacters,
  fetchPartsForCharacter,
  getEmoteBaseUrl,
  validateEmote,
  type EmoteConfig
} from '../../services/emoteGenerator'

const commandName = 'emote'
const MAX_CHOICES = 25

export default {
  data: new SlashCommandBuilder()
    .setName(commandName)
    .setDescription('Generate a character emote and post it as an embed.')
    .addStringOption((opt) =>
      opt
        .setName('character')
        .setDescription('Which character to draw.')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('eyebrows')
        .setDescription('Eyebrow expression.')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption((opt) =>
      opt.setName('eyes').setDescription('Eye expression.').setRequired(true).setAutocomplete(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('mouth')
        .setDescription('Mouth expression.')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('head')
        .setDescription('Head style (defaults to "normal").')
        .setRequired(false)
        .setAutocomplete(true)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply()

    const config: EmoteConfig = {
      character: interaction.options.getString('character', true).toLowerCase(),
      eyebrows: interaction.options.getString('eyebrows', true).toLowerCase(),
      eyes: interaction.options.getString('eyes', true).toLowerCase(),
      mouth: interaction.options.getString('mouth', true).toLowerCase(),
      head: (interaction.options.getString('head') ?? 'normal').toLowerCase()
    }

    const error = await validateEmote(config)
    if (error) {
      await interaction.editReply(
        `I couldn’t build that emote for **${config.character}**: ${error}\n` +
          'Double-check the part names — the autocomplete suggestions are the safe choices.'
      )
      return
    }

    const url = buildEmoteUrl(config)
    const title = config.character.charAt(0).toUpperCase() + config.character.slice(1)
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(
        `head: ${config.head} • eyebrows: ${config.eyebrows} • ` +
          `eyes: ${config.eyes} • mouth: ${config.mouth}`
      )
      .setImage(url)
      .setURL(url)

    await interaction.editReply({ embeds: [embed] })
  },

  async autocomplete(interaction: AutocompleteInteraction) {
    const focused = interaction.options.getFocused(true)
    const query = focused.value.toLowerCase()

    try {
      let options: string[] = []

      if (focused.name === 'character') {
        options = await fetchCharacters()
      } else {
        const character = interaction.options.getString('character')
        if (character) {
          const parts = await fetchPartsForCharacter(character)
          options = parts[focused.name] ?? []
        }
      }

      const suggestions = options
        .filter((option) => option.toLowerCase().includes(query))
        .slice(0, MAX_CHOICES)
        .map((option) => ({ name: option, value: option }))

      await interaction.respond(suggestions)
    } catch (error) {
      console.error(`Emote autocomplete failed (${getEmoteBaseUrl()}):`, error)
      // Respond with nothing rather than letting the interaction time out.
      if (!interaction.responded) await interaction.respond([])
    }
  }
} satisfies BotCommand
