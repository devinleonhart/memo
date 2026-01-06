import {
  ActionRowBuilder,
  ComponentType,
  Events,
  StringSelectMenuBuilder,
  type StringSelectMenuInteraction,
  type Collection,
  type Client,
  type MessageReaction,
  type User,
  type Message
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
const PROMPT_TTL_MS = 60_000
const ERROR_TTL_MS = 10_000
const FAILURE_TTL_MS = 60_000

module.exports = {
  name: Events.MessageReactionAdd,
  async execute (reaction: MessageReaction, user: User, client: Client) {
    void client
    if (user.bot) return

    if (reaction.emoji?.name !== BLACKBOOK_REACTION_EMOJI) return

    if (reaction.partial) {
      try { await reaction.fetch() } catch { return }
    }

    // For robustness (especially for URL extraction), always fetch the message.
    // In practice, `reaction.message` may be non-partial yet still missing `content`
    // depending on cache/state; fetching aligns behavior with `/blackbook export`.
    const msg = await reaction.message.fetch().catch(async (e) => {
      console.error('blackbookit: failed to fetch message for reaction upload', e)
      const base: any = reaction.message as any
      if (base?.reply) {
        await sendTempReply(base, {
          content:
            `I couldn’t read that message to upload it (fetch failed).\n` +
            `Make sure I have **View Channel** + **Read Message History** in this channel.`
        }, FAILURE_TTL_MS)
      }
      return null
    })
    if (!msg) return

    const sources = getImageSources(msg)
    if (sources.length === 0) {
      await sendTempReply(msg, {
        content:
          `I didn’t find an image attachment or image URL on that message to upload.\n` +
          `If the image is a link, make sure the bot can read message content (Message Content Intent), or use \`/blackbook export\`.`
      }, ERROR_TTL_MS)
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

    const prompt = await safeReply(msg, {
      content: 'Select the Blackbook universe for this image:',
      components: [row],
      allowedMentions: { repliedUser: false, parse: [] }
    })
    if (!prompt) {
      inflight.delete(key)
      return
    }

    const collector = prompt.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      time: PROMPT_TTL_MS,
      max: 1,
      filter: (i: StringSelectMenuInteraction) => i.user.id === user.id && i.customId === customId
    })

    collector.on('collect', async (i: StringSelectMenuInteraction) => {
      const universeCode = i.values[0] ?? ''
      await i.deferUpdate()

      try {
        await prompt.edit({ components: [] }).catch(() => {})

        const baseUrl = process.env.BLACKBOOK_BASE_URL?.trim()
        const apiToken = process.env.BLACKBOOK_API_TOKEN?.trim()
        if (!baseUrl) {
          await prompt.edit({ content: 'Missing `BLACKBOOK_BASE_URL` in environment.', components: [] }).catch(() => {})
          scheduleDelete(prompt, ERROR_TTL_MS)
          return
        }
        if (!apiToken) {
          await prompt.edit({ content: 'Missing `BLACKBOOK_API_TOKEN` in environment.', components: [] }).catch(() => {})
          scheduleDelete(prompt, ERROR_TTL_MS)
          return
        }

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

        if (failed > 0 || uploaded === 0) {
          console.error(
            `blackbookit: upload summary msg=${msg.id} user=${user.id} universe=${universeCode} uploaded=${uploaded} skipped=${skipped} failed=${failed}`
          )
          await prompt.edit({
            content:
              `Blackbook upload result for **${universeCode}**:\n` +
              `Uploaded: ${uploaded}\n` +
              `Skipped: ${skipped}\n` +
              `Failed: ${failed}\n\n` +
              `If this is a link upload, it may be getting skipped because the URL doesn’t return an \`image/*\` content-type. ` +
              `Check the bot logs for details.`,
            components: []
          }).catch(() => {})
          scheduleDelete(prompt, FAILURE_TTL_MS)
          return
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

async function safeReply (msg: Message, payload: any): Promise<any | null> {
  try {
    return await msg.reply(payload)
  } catch {
    return null
  }
}

async function sendTempReply (msg: any, payload: any, ttlMs: number): Promise<void> {
  const sent = await safeReply(msg, { ...payload, allowedMentions: { repliedUser: false, parse: [] } })
  if (!sent) return
  scheduleDelete(sent, ttlMs)
}

function scheduleDelete (msg: any, ttlMs: number): void {
  try {
    const t: any = setTimeout(() => { void msg.delete().catch(() => {}) }, ttlMs)
    t?.unref?.()
  } catch {}
}
