import { SlashCommandBuilder } from '@discordjs/builders'
import {
  type ChatInputCommandInteraction,
  type Message,
  PermissionFlagsBits,
  type TextBasedChannel
} from 'discord.js'

const commandName = 'blackbook'
const emojiName = 'blackbookit'

// Scan up to 2 years of history, capped to avoid unbounded work.
const MAX_MESSAGES_TO_SCAN = 100_000
const TWO_YEARS_MS = 1000 * 60 * 60 * 24 * 365 * 2

module.exports = {
  data: new SlashCommandBuilder()
    .setName(commandName)
    .setDescription('Scan channel history for :blackbookit: reactions.')
    .addStringOption(opt =>
      opt
        .setName('mode')
        .setDescription('What to do with :blackbookit: reactions in this channel.')
        .setRequired(true)
        .addChoices(
          { name: 'count', value: 'count' },
          { name: 'print', value: 'print' }
        )
    ),

  async execute (interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true })

    const channel = interaction.channel
    if (!channel || !channel.isTextBased()) {
      await interaction.editReply('This command must be run in a text-based channel.')
      return
    }

    // Permission check (guild channels). DMs don't use these permissions.
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
          `I can’t read this channel’s history. Missing permission(s): ${missing.join(', ')}.\n` +
          `Fix: give the bot role those permissions in this channel, or re-invite the bot with them.`
        )
        return
      }
    }

    const mode = interaction.options.getString('mode', true)
    const { totalReactions, urls, scanned } = await scanChannel(channel)

    if (mode === 'count') {
      await interaction.editReply(
        `Scanned ${scanned} message(s). Found ${totalReactions} :${emojiName}: reaction(s).`
      )
      return
    }

    // mode === 'print'
    if (urls.length === 0) {
      await interaction.editReply(
        `Scanned ${scanned} message(s). No URLs found on messages with :${emojiName}: reactions.`
      )
      return
    }

    const header = `Scanned ${scanned} message(s). URLs on messages with :${emojiName}: reactions:\n`
    const maxLines = 50
    const lines = urls.slice(0, maxLines)
    const suffix = urls.length > maxLines ? `\n\n(Showing ${maxLines} of ${urls.length})` : ''

    const body = lines.join('\n')
    const full = header + body + suffix

    // Keep it within Discord's 2000 character limit.
    if (full.length <= 1900) {
      await interaction.editReply(full)
      return
    }

    // Fallback: chunk by line.
    const chunks: string[] = []
    let current = header
    for (const line of lines) {
      if ((current + line + '\n').length > 1900) {
        chunks.push(current)
        current = ''
      }
      current += line + '\n'
    }
    if (current.trim().length > 0) chunks.push(current + suffix)

    await interaction.editReply(chunks[0] ?? 'No output.')
    for (const chunk of chunks.slice(1)) {
      await interaction.followUp({ content: chunk, ephemeral: true })
    }
  }
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

function getReactionCount (msg: Message, targetName: string): number {
  const reaction = msg.reactions.cache.find(r => r.emoji?.name === targetName)
  return reaction?.count ?? 0
}

function extractUrls (text: string): string[] {
  if (!text) return []
  const matches = text.match(/https?:\/\/[^\s<>()]+/g) ?? []
  return matches.map(m => m.replace(/[),.!?]+$/g, ''))
}
