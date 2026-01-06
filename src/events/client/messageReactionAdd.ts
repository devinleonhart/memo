import {
  ActionRowBuilder,
  ComponentType,
  Events,
  StringSelectMenuBuilder,
  type Client,
  type MessageReaction,
  type User
} from 'discord.js'
import { promises as fs } from 'fs'
import { resolve } from 'path'
import {
  BLACKBOOK_REACTION_EMOJI,
  BLACKBOOK_UNIVERSE_CHOICES,
  getImageSources,
  getSpoolDir,
  loadShaIndex,
  processSource
} from '../../services/blackbookImport'

const inflight = new Set<string>()

module.exports = {
  name: Events.MessageReactionAdd,
  async execute (reaction: MessageReaction, user: User, client: Client) {
    void client // match other events’ signature style; not used here
    if (user.bot) return

    // For custom emojis, discord.js sets emoji.name to the emoji's name.
    if (reaction.emoji?.name !== BLACKBOOK_REACTION_EMOJI) return

    // Partial safety (reactions/messages may not be cached).
    if (reaction.partial) {
      try { await reaction.fetch() } catch { return }
    }

    const msg = reaction.message.partial
      ? await reaction.message.fetch().catch(() => null)
      : reaction.message
    if (!msg) return
    const channel = msg.channel
    if (!channel || !channel.isTextBased()) return

    const sources = getImageSources(msg)
    if (sources.length === 0) {
      // Avoid spamming the channel; only nudge when it's clearly not an image.
      await msg.reply(`<@${user.id}> I didn’t find an image attachment on that message to upload.`)
      return
    }

    const key = `${user.id}:${msg.id}`
    if (inflight.has(key)) return
    inflight.add(key)

    const customId = `blackbookit:universe:${msg.id}:${user.id}`
    const select = new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder('Choose a Blackbook universe…')
      .addOptions(BLACKBOOK_UNIVERSE_CHOICES.map(c => ({ label: c.name, value: c.value })))

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)

    const prompt = await msg.reply({
      content: `<@${user.id}> Which Blackbook universe should this image be uploaded to?`,
      components: [row]
    })

    const collector = prompt.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      time: 60_000,
      max: 1,
      filter: i => i.user.id === user.id && i.customId === customId
    })

    collector.on('collect', async i => {
      const universeCode = i.values[0] ?? ''
      await i.deferUpdate()

      try {
        const baseUrl = process.env.BLACKBOOK_BASE_URL?.trim()
        const apiToken = process.env.BLACKBOOK_API_TOKEN?.trim()
        if (!baseUrl) {
          await prompt.edit({ content: 'Missing BLACKBOOK_BASE_URL in environment.', components: [] })
          return
        }
        if (!apiToken) {
          await prompt.edit({ content: 'Missing BLACKBOOK_API_TOKEN in environment.', components: [] })
          return
        }

        await prompt.edit({ content: `Uploading to **${universeCode}**…`, components: [] })

        const spoolDir = getSpoolDir()
        await fs.mkdir(spoolDir, { recursive: true })
        const indexPath = resolve(spoolDir, 'sha256-index.txt')
        const known = await loadShaIndex(indexPath)

        let uploaded = 0
        let skipped = 0
        let failed = 0

        for (const src of sources) {
          const result = await processSource({
            universeCode,
            baseUrl,
            apiToken,
            spoolDir,
            indexPath,
            known,
            src,
            caption: `Imported from Discord reaction: ${msg.url}`
          })
          if (result === 'uploaded') uploaded += 1
          else if (result === 'skipped') skipped += 1
          else failed += 1
        }

        await prompt.edit({
          content:
            `Uploaded to **${universeCode}**.\n` +
            `Uploaded: ${uploaded}, Skipped (dedupe): ${skipped}, Failed: ${failed}`,
          components: []
        })
      } finally {
        inflight.delete(key)
      }
    })

    collector.on('end', async collected => {
      if (collected.size > 0) return
      inflight.delete(key)
      await prompt.edit({
        content: `<@${user.id}> Timed out waiting for a universe selection. React with :${BLACKBOOK_REACTION_EMOJI}: again to retry.`,
        components: []
      }).catch(() => {})
    })
  }
}
