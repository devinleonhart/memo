import {
  ActionRowBuilder,
  ComponentType,
  Events,
  StringSelectMenuBuilder,
  type StringSelectMenuInteraction,
  type Collection,
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
    void client
    if (user.bot) return

    if (reaction.emoji?.name !== BLACKBOOK_REACTION_EMOJI) return

    if (reaction.partial) {
      try { await reaction.fetch() } catch { return }
    }

    const msg = reaction.message.partial
      ? await reaction.message.fetch().catch(() => null)
      : reaction.message
    if (!msg) return

    const sources = getImageSources(msg)
    if (sources.length === 0) {
      await sendPrivate(user, {
        content:
          `I didn’t find an image attachment on that message to upload.\n` +
          `If the image is a link, please post it as an attachment or use \`/blackbook export\`.`
      })
      return
    }

    const key = `${user.id}:${msg.id}`
    if (inflight.has(key)) return
    inflight.add(key)

    const customId = `blackbookit:universe:${msg.id}:${user.id}`
    const select = new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder('Select a Blackbook universe…')
      .addOptions(BLACKBOOK_UNIVERSE_CHOICES.map(c => ({ label: c.name, value: c.value })))

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)

    const prompt = await sendPrivate(user, {
      content:
        `Please select the Blackbook universe for this image:`,
      components: [row]
    })
    if (!prompt) {
      inflight.delete(key)
      return
    }

    const collector = prompt.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      time: 60_000,
      max: 1,
      filter: (i: StringSelectMenuInteraction) => i.user.id === user.id && i.customId === customId
    })

    collector.on('collect', async (i: StringSelectMenuInteraction) => {
      const universeCode = i.values[0] ?? ''
      await i.deferUpdate()

      try {
        const baseUrl = process.env.BLACKBOOK_BASE_URL?.trim()
        const apiToken = process.env.BLACKBOOK_API_TOKEN?.trim()
        if (!baseUrl) {
          await prompt.edit({ content: 'Missing `BLACKBOOK_BASE_URL` in environment.', components: [] })
          return
        }
        if (!apiToken) {
          await prompt.edit({ content: 'Missing `BLACKBOOK_API_TOKEN` in environment.', components: [] })
          return
        }

        await prompt.edit({ components: [] }).catch(() => {})

        const spoolDir = getSpoolDir()
        await fs.mkdir(spoolDir, { recursive: true })
        const indexPath = resolve(spoolDir, 'sha256-index.txt')
        const known = await loadShaIndex(indexPath)

        for (const src of sources) {
          await processSource({
            universeCode,
            baseUrl,
            apiToken,
            spoolDir,
            indexPath,
            known,
            src,
            caption: `Imported from Discord reaction: ${msg.url}`
          })
        }
        await prompt.delete().catch(() => {})
      } finally {
        inflight.delete(key)
      }
    })

    collector.on('end', async (collected: Collection<string, StringSelectMenuInteraction>) => {
      if (collected.size > 0) return
      inflight.delete(key)
      await prompt.delete().catch(() => {})
    })
  }
}

async function sendPrivate (user: User, payload: any): Promise<any | null> {
  try {
    const dm = await user.createDM()
    return await dm.send(payload)
  } catch {
    return null
  }
}
