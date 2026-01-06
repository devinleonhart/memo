import { SlashCommandBuilder } from '@discordjs/builders'
import {
  type ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  type TextBasedChannel
} from 'discord.js'
import { promises as fs } from 'fs'
import { resolve } from 'path'
import {
  BLACKBOOK_REACTION_EMOJI,
  BLACKBOOK_UNIVERSE_CHOICES,
  extractUrls,
  getImageSources,
  getReactionCount,
  getSpoolDir,
  loadShaIndex,
  processSource
} from '../../services/blackbookImport'

const commandName = 'blackbook'
const emojiName = BLACKBOOK_REACTION_EMOJI

const MAX_MESSAGES_TO_SCAN = 100_000
const TWO_YEARS_MS = 1000 * 60 * 60 * 24 * 365 * 2

module.exports = {
  data: new SlashCommandBuilder()
    .setName(commandName)
    .setDescription('Review channel history for :blackbookit: reactions.')
    .addSubcommand(sub =>
      sub
        .setName('count')
        .setDescription('Count :blackbookit: reactions in this channel.')
    )
    .addSubcommand(sub =>
      sub
        .setName('export')
        .setDescription('Export images marked with :blackbookit: to Blackbook.')
        .addStringOption(opt =>
          opt
            .setName('universe')
            .setDescription('Choose the Blackbook universe to upload into.')
            .setRequired(true)
            .addChoices(...BLACKBOOK_UNIVERSE_CHOICES)
        )
    ),

  async execute (interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral })

    const channel = interaction.channel
    if (!channel || !channel.isTextBased()) {
      await interaction.editReply('Please run this command in a text channel.')
      return
    }

    if (interaction.inGuild()) {
      const me = interaction.guild?.members.me
      const perms = 'permissionsFor' in channel
        ? (channel as any).permissionsFor(me ?? interaction.client.user)
        : undefined
      const missing: string[] = []

      if (!perms?.has(PermissionFlagsBits.ViewChannel)) missing.push('View Channel')
      if (!perms?.has(PermissionFlagsBits.ReadMessageHistory)) missing.push('Read Message History')

      if (missing.length > 0) {
        await interaction.editReply(
          `I can’t read this channel’s message history. I am missing these permissions: ${missing.join(', ')}.\n` +
          'Please grant these permissions to the bot role in this channel, or re-invite the bot with them enabled.'
        )
        return
      }
    }

    const sub = interaction.options.getSubcommand()

    if (sub === 'count') {
      const { totalReactions, scanned } = await scanChannel(channel)
      await interaction.editReply(
        `Reviewed ${scanned} messages. Found ${totalReactions} :${emojiName}: reactions.`
      )
      return
    }

    const universeCode = interaction.options.getString('universe', true)
    await exportChannel(interaction, channel, universeCode)
  }
}

async function exportChannel (
  interaction: ChatInputCommandInteraction,
  channel: TextBasedChannel,
  universeCode: string
): Promise<void> {
  const baseUrl = process.env.BLACKBOOK_BASE_URL?.trim()
  const apiToken = process.env.BLACKBOOK_API_TOKEN?.trim()
  if (!baseUrl) {
    await interaction.editReply('This bot is missing `BLACKBOOK_BASE_URL` in its environment.')
    return
  }
  if (!apiToken) {
    await interaction.editReply('This bot is missing `BLACKBOOK_API_TOKEN` in its environment.')
    return
  }

  const spoolDir = getSpoolDir()
  await fs.mkdir(spoolDir, { recursive: true })
  const indexPath = resolve(spoolDir, 'sha256-index.txt')
  const known = await loadShaIndex(indexPath)

  let scanned = 0
  let markedMessages = 0
  let candidates = 0
  let uploaded = 0
  let skipped = 0
  let failed = 0

  const cutoff = Date.now() - TWO_YEARS_MS
  let before: string | undefined
  let reachedCutoff = false

  await interaction.editReply(
    `Starting export to **${universeCode}**.\n` +
    `Using spool directory: \`${spoolDir}\``
  )

  while (scanned < MAX_MESSAGES_TO_SCAN && !reachedCutoff) {
    const remaining = MAX_MESSAGES_TO_SCAN - scanned
    const batchSize = Math.min(100, remaining)

    const batch = await channel.messages.fetch({ limit: batchSize, before })
    if (batch.size === 0) break

    for (const msg of batch.values()) {
      if (msg.createdTimestamp < cutoff) {
        reachedCutoff = true
        break
      }
      scanned += 1

      const count = getReactionCount(msg, emojiName)
      if (count <= 0) continue
      markedMessages += 1

      const sources = getImageSources(msg)
      for (const src of sources) {
        candidates += 1
        const result = await processSource({
          universeCode,
          baseUrl,
          apiToken,
          spoolDir,
          indexPath,
          known,
          src,
          caption: `Imported from Discord: ${msg.url}`
        })

        if (result === 'uploaded') uploaded += 1
        else if (result === 'skipped') skipped += 1
        else failed += 1

        if ((uploaded + skipped + failed) % 10 === 0) {
          await interaction.editReply(
            `Exporting to **${universeCode}**.\n` +
            `Scanned: ${scanned}\n` +
            `Marked messages: ${markedMessages}\n` +
            `Candidates: ${candidates}\n` +
            `Uploaded: ${uploaded}\n` +
            `Skipped: ${skipped}\n` +
            `Failed: ${failed}`
          )
        }
      }
    }

    before = batch.last()?.id
    if (!before) break
  }

  await interaction.editReply(
    `Export complete for **${universeCode}**.\n` +
    `Scanned: ${scanned}\n` +
    `Marked messages: ${markedMessages}\n` +
    `Candidates: ${candidates}\n` +
    `Uploaded: ${uploaded}\n` +
    `Skipped due to deduplication: ${skipped}\n` +
    `Failed: ${failed}`
  )
}

async function scanChannel (channel: TextBasedChannel): Promise<{
  scanned: number
  totalReactions: number
  urls: string[]
}> {
  let scanned = 0
  let totalReactions = 0
  const urlSet = new Set<string>()
  const cutoff = Date.now() - TWO_YEARS_MS

  let before: string | undefined
  let reachedCutoff = false
  while (scanned < MAX_MESSAGES_TO_SCAN && !reachedCutoff) {
    const remaining = MAX_MESSAGES_TO_SCAN - scanned
    const batchSize = Math.min(100, remaining)

    const batch = await channel.messages.fetch({ limit: batchSize, before })
    if (batch.size === 0) break

    for (const msg of batch.values()) {
      if (msg.createdTimestamp < cutoff) {
        reachedCutoff = true
        break
      }
      scanned += 1
      const count = getReactionCount(msg, emojiName)
      if (count <= 0) continue

      totalReactions += count
      for (const url of extractUrls(msg.content)) {
        urlSet.add(url)
      }
    }

    before = batch.last()?.id
    if (!before) break
  }

  return { scanned, totalReactions, urls: Array.from(urlSet) }
}
