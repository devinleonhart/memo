import { SlashCommandBuilder } from '@discordjs/builders'
import {
  type Attachment,
  type ChatInputCommandInteraction,
  type Message,
  MessageFlags,
  PermissionFlagsBits,
  type TextBasedChannel
} from 'discord.js'
import { createHash } from 'crypto'
import { createWriteStream, openAsBlob, promises as fs } from 'fs'
import { resolve } from 'path'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'

const commandName = 'blackbook'
const emojiName = 'blackbookit'

// Scan up to 2 years of history, capped to avoid unbounded work.
const MAX_MESSAGES_TO_SCAN = 100_000
const TWO_YEARS_MS = 1000 * 60 * 60 * 24 * 365 * 2

// Safety cap for any single download.
const MAX_IMAGE_BYTES = 100 * 1024 * 1024 // 100MB

module.exports = {
  data: new SlashCommandBuilder()
    .setName(commandName)
    .setDescription('Scan channel history for :blackbookit: reactions.')
    .addSubcommand(sub =>
      sub
        .setName('count')
        .setDescription('Count :blackbookit: reactions in this channel.')
    )
    .addSubcommand(sub =>
      sub
        .setName('print')
        .setDescription('Print URLs found on messages with :blackbookit: reactions in this channel.')
    )
    .addSubcommand(sub =>
      sub
        .setName('export')
        .setDescription('Export images marked with :blackbookit: to Blackbook.')
        .addStringOption(opt =>
          opt
            .setName('universe')
            .setDescription('Which Blackbook universe to upload into.')
            .setRequired(true)
            .addChoices(
              { name: 'Universe One (U1)', value: 'U1' },
              { name: 'Universe Two (U2)', value: 'U2' },
              { name: 'Universe Three (U3)', value: 'U3' },
              { name: 'Universe Four (U4)', value: 'U4' },
              { name: 'Universe Five (U5)', value: 'U5' },
              { name: 'Universe Six (U6)', value: 'U6' }
            )
        )
    ),

  async execute (interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral })

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
          'Fix: give the bot role those permissions in this channel, or re-invite the bot with them.'
        )
        return
      }
    }

    const sub = interaction.options.getSubcommand()

    if (sub === 'count') {
      const { totalReactions, scanned } = await scanChannel(channel)
      await interaction.editReply(
        `Scanned ${scanned} message(s). Found ${totalReactions} :${emojiName}: reaction(s).`
      )
      return
    }

    if (sub === 'print') {
      const { urls, scanned } = await scanChannel(channel)
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

      if (full.length <= 1900) {
        await interaction.editReply(full)
        return
      }

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
        await interaction.followUp({ content: chunk, flags: MessageFlags.Ephemeral })
      }
      return
    }

    // sub === 'export'
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
    await interaction.editReply('Missing BLACKBOOK_BASE_URL in environment.')
    return
  }
  if (!apiToken) {
    await interaction.editReply('Missing BLACKBOOK_API_TOKEN in environment.')
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
    `Starting export to **${universeCode}**...\n` +
    `Spool: \`${spoolDir}\``
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
            `Exporting to **${universeCode}**...\n` +
            `Scanned: ${scanned}\n` +
            `Marked messages: ${markedMessages}\n` +
            `Candidates: ${candidates}\n` +
            `Uploaded: ${uploaded}, Skipped: ${skipped}, Failed: ${failed}`
          )
        }
      }
    }

    before = batch.last()?.id
    if (!before) break
  }

  await interaction.editReply(
    `Export complete → **${universeCode}**\n` +
    `Scanned: ${scanned}\n` +
    `Marked messages: ${markedMessages}\n` +
    `Candidates: ${candidates}\n` +
    `Uploaded: ${uploaded}\n` +
    `Skipped (dedupe): ${skipped}\n` +
    `Failed: ${failed}`
  )
}

type ImageSource =
  | { kind: 'attachment', url: string, filename?: string, contentType?: string }
  | { kind: 'url', url: string }

function getImageSources (msg: Message): ImageSource[] {
  const out: ImageSource[] = []

  for (const a of msg.attachments.values() as Iterable<Attachment>) {
    if (isLikelyImageAttachment(a)) {
      out.push({
        kind: 'attachment',
        url: a.url,
        filename: a.name ?? undefined,
        contentType: a.contentType ?? undefined
      })
    }
  }

  for (const url of extractUrls(msg.content)) {
    out.push({ kind: 'url', url })
  }

  return out
}

function isLikelyImageAttachment (a: Attachment): boolean {
  const ct = (a.contentType ?? '').toLowerCase()
  if (ct.startsWith('image/')) return true
  const name = (a.name ?? '').toLowerCase()
  return name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.gif') || name.endsWith('.webp')
}

async function processSource (args: {
  universeCode: string
  baseUrl: string
  apiToken: string
  spoolDir: string
  indexPath: string
  known: Set<string>
  src: ImageSource
  caption: string
}): Promise<'uploaded' | 'skipped' | 'failed'> {
  try {
    const downloaded = await downloadToSpool(args.src, args.spoolDir)
    if (!downloaded) return 'skipped'

    const { filePath, sha256 } = downloaded
    if (args.known.has(sha256)) {
      await fs.unlink(filePath).catch(() => {})
      return 'skipped'
    }

    const imageId = await uploadToBlackbook({
      baseUrl: args.baseUrl,
      apiToken: args.apiToken,
      universeCode: args.universeCode,
      caption: args.caption,
      filePath
    })

    // Record dedupe only after success so failures can be retried.
    await appendShaIndex(args.indexPath, sha256)
    args.known.add(sha256)

    // Requested behavior: delete spool files after uploading.
    await fs.unlink(filePath).catch(() => {})

    console.log(`Uploaded to Blackbook image_id=${imageId} sha256=${sha256}`)
    return 'uploaded'
  } catch (e) {
    console.error(e)
    return 'failed'
  }
}

async function uploadToBlackbook (args: {
  baseUrl: string
  apiToken: string
  universeCode: string
  caption: string
  filePath: string
}): Promise<number> {
  const primaryUrl = new URL('/api/discord_imports/images', args.baseUrl).toString()

  const blob = await openAsBlob(args.filePath)
  const filename = args.filePath.split('/').pop() ?? 'upload.bin'

  const form = new FormData()
  form.append('universe_code', args.universeCode)
  form.append('caption', args.caption)
  form.append('image_file', blob, filename)

  try {
    return await doUpload(primaryUrl, args.apiToken, form, args.baseUrl)
  } catch (error: any) {
    // Common production failure: using https://blackbook:3000 even though the internal service is plain HTTP.
    // That yields SSL errors like "packet length too long".
    const canRetryHttp =
      looksLikeSslProtocolError(error) &&
      isLikelyInternalServiceUrl(args.baseUrl)

    if (!canRetryHttp) throw error

    const httpBase = forceHttp(args.baseUrl)
    const retryUrl = new URL('/api/discord_imports/images', httpBase).toString()

    // Re-open the blob for retry because the previous request body may have been consumed.
    const retryBlob = await openAsBlob(args.filePath)
    const retryForm = new FormData()
    retryForm.append('universe_code', args.universeCode)
    retryForm.append('caption', args.caption)
    retryForm.append('image_file', retryBlob, filename)

    return await doUpload(retryUrl, args.apiToken, retryForm, httpBase)
  }
}

async function doUpload (
  url: string,
  apiToken: string,
  form: FormData,
  baseUrl: string
): Promise<number> {
  const resp = await fetch(url, {
    method: 'POST',
    // Prevent Rails force_ssl redirects when calling the internal HTTP service.
    // (Blackbook is behind nginx in prod; internally it's still HTTP on :3000.)
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'X-Forwarded-Proto': 'https'
    },
    // Don't auto-follow redirects; a 301 here is a misconfiguration signal.
    redirect: 'manual',
    body: form
  })

  const bodyText = await resp.text()
  if (!resp.ok) {
    const location = resp.headers.get('location')
    const locPart = location ? ` location=${location}` : ''
    throw new Error(`Blackbook upload failed: base=${baseUrl} url=${url} status=${resp.status}${locPart} body=${bodyText}`)
  }

  const parsed = JSON.parse(bodyText) as any
  return parsed.image_id as number
}

function looksLikeSslProtocolError (error: any): boolean {
  const msg = String(error?.message ?? '')
  const code = String(error?.cause?.code ?? error?.code ?? '')
  return (
    msg.includes('ERR_SSL_PACKET_LENGTH_TOO_LONG') ||
    msg.includes('wrong version number') ||
    msg.includes('SSL') ||
    code === 'ERR_SSL_PACKET_LENGTH_TOO_LONG'
  )
}

function isLikelyInternalServiceUrl (baseUrl: string): boolean {
  try {
    const u = new URL(baseUrl)
    // docker-compose service name + typical Rails port
    return u.hostname === 'blackbook' || (u.hostname === 'localhost' && u.port === '3000')
  } catch {
    return false
  }
}

function forceHttp (baseUrl: string): string {
  const u = new URL(baseUrl)
  u.protocol = 'http:'
  return u.toString()
}

async function downloadToSpool (
  src: ImageSource,
  spoolDir: string
): Promise<null | { filePath: string, sha256: string }> {
  const resp = await fetch(src.url)
  if (!resp.ok) return null

  const contentType = (resp.headers.get('content-type') ?? (src.kind === 'attachment' ? src.contentType : '') ?? '').toLowerCase()
  if (!contentType.startsWith('image/')) return null

  const ext = extensionFor(contentType, src)
  const tmpPath = resolve(spoolDir, `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`)

  const hasher = createHash('sha256')
  let bytes = 0

  const body = resp.body
  if (!body) return null

  const nodeStream = Readable.fromWeb(body as any)
  nodeStream.on('data', (chunk: Buffer) => {
    bytes += chunk.length
    if (bytes > MAX_IMAGE_BYTES) {
      nodeStream.destroy(new Error(`Image too large (> ${MAX_IMAGE_BYTES} bytes)`))
      return
    }
    hasher.update(chunk)
  })

  await pipeline(nodeStream, createWriteStream(tmpPath))
  const sha256 = hasher.digest('hex')

  const finalPath = resolve(spoolDir, `${sha256}${ext}`)
  try {
    await fs.rename(tmpPath, finalPath)
  } catch {
    await fs.unlink(tmpPath).catch(() => {})
  }

  return { filePath: finalPath, sha256 }
}

function extensionFor (contentType: string, src: ImageSource): string {
  if (contentType.includes('png')) return '.png'
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return '.jpg'
  if (contentType.includes('gif')) return '.gif'
  if (contentType.includes('webp')) return '.webp'

  try {
    const pathname = new URL(src.url).pathname.toLowerCase()
    const m = pathname.match(/\.(png|jpe?g|gif|webp)$/)
    if (m) return `.${m[1] === 'jpeg' ? 'jpg' : m[1]}`
  } catch {}

  return ''
}

function getSpoolDir (): string {
  const env = process.env.MEMO_SPOOL_DIR?.trim()
  if (env) return env
  return resolve(process.cwd(), 'data/blackbook-spool')
}

async function loadShaIndex (indexPath: string): Promise<Set<string>> {
  try {
    const buf = await fs.readFile(indexPath, 'utf8')
    const set = new Set<string>()
    for (const line of buf.split(/\r?\n/)) {
      const v = line.trim()
      if (v) set.add(v)
    }
    return set
  } catch {
    return new Set<string>()
  }
}

async function appendShaIndex (indexPath: string, sha256: string): Promise<void> {
  await fs.appendFile(indexPath, `${sha256}\n`, 'utf8')
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
