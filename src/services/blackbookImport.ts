import { createHash } from 'crypto'
import { createWriteStream, openAsBlob, promises as fs, constants as FS_CONSTANTS } from 'fs'
import { tmpdir } from 'os'
import { resolve } from 'path'
import { pipeline } from 'stream/promises'
import { type Attachment, type Message } from 'discord.js'
import { fetchPublic } from './publicFetch'

export const BLACKBOOK_REACTION_EMOJI = 'blackbookit'

const MAX_CHOICES = 25 // Discord's limit for a command option and for a select menu

// The universes are not in the code: MEMO_BLACKBOOK_UNIVERSES holds "CODE=Name" pairs, separated by ";".
export function getUniverseChoices (): Array<{ name: string, value: string }> {
  const choices: Array<{ name: string, value: string }> = []
  for (const pair of (process.env.MEMO_BLACKBOOK_UNIVERSES ?? '').split(/[;\n]/)) {
    const at = pair.indexOf('=')
    const value = pair.slice(0, Math.max(at, 0)).trim()
    const name = pair.slice(at + 1).trim()
    if (at < 1 || !value || !name || choices.some(c => c.value === value)) continue
    choices.push({ name: name.slice(0, 100), value: value.slice(0, 100) })
  }
  return choices.slice(0, MAX_CHOICES)
}

const MAX_IMAGE_BYTES = 100 * 1024 * 1024

type ImageSource =
  | { kind: 'attachment', url: string, filename?: string, contentType?: string }
  | { kind: 'url', url: string }

export function getReactionCount (msg: Message, targetName: string): number {
  const reaction = msg.reactions.cache.find(r => r.emoji?.name === targetName)
  return reaction?.count ?? 0
}

export function getImageSources (msg: Message): ImageSource[] {
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

export function extractUrls (text: string): string[] {
  if (!text) return []
  const matches = text.match(/https?:\/\/[^\s<>()]+/g) ?? []
  return matches.map(m => m.replace(/[),.!?]+$/g, ''))
}

export function getSpoolDir (): string {
  const env = process.env.MEMO_SPOOL_DIR?.trim()
  if (env) return env
  return resolve(process.cwd(), 'data/blackbook-spool')
}

export async function resolveWritableSpoolDir (preferredDir?: string): Promise<string> {
  const preferred = preferredDir?.trim() || getSpoolDir()
  const fallbacks = [
    // Typical containerized dev setup writes here (docker-compose mounts ./data → /app/data)
    resolve(process.cwd(), 'data/blackbook-spool'),
    resolve(tmpdir(), 'memo-blackbook-spool')
  ]

  for (const dir of [preferred, ...fallbacks]) {
    try {
      await fs.mkdir(dir, { recursive: true })
      await fs.access(dir, FS_CONSTANTS.W_OK)
      return dir
    } catch (e: any) {
      const code = String(e?.code ?? '')
      if (dir === preferred) {
        console.error(`Spool dir not writable: ${preferred} code=${code}`)
      }
    }
  }

  // If all else fails, return preferred and let the caller surface the real error.
  return preferred
}

export async function loadShaIndex (indexPath: string): Promise<Set<string>> {
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

export async function appendShaIndex (indexPath: string, sha256: string): Promise<void> {
  await fs.appendFile(indexPath, `${sha256}\n`, 'utf8')
}

export async function processSource (args: {
  universeCode: string
  baseUrl: string
  apiToken: string
  spoolDir: string
  indexPath: string
  known: Set<string>
  src: ImageSource
  caption: string
}): Promise<'uploaded' | 'skipped' | 'failed'> {
  let downloaded: Awaited<ReturnType<typeof downloadToSpool>> = null
  try {
    downloaded = await downloadToSpool(args.src, args.spoolDir)
    if (!downloaded) return 'skipped'

    const { filePath, sha256 } = downloaded
    if (args.known.has(sha256)) {
      return 'skipped'
    }

    const imageId = await uploadToBlackbook({
      baseUrl: args.baseUrl,
      apiToken: args.apiToken,
      universeCode: args.universeCode,
      caption: args.caption,
      filePath
    })

    await appendShaIndex(args.indexPath, sha256)
    args.known.add(sha256)

    console.log(`Uploaded to Blackbook image_id=${imageId} sha256=${sha256}`)
    return 'uploaded'
  } catch (e) {
    console.error(e)
    return 'failed'
  } finally {
    // Only the index stays in the spool; a failed image is downloaded again.
    if (downloaded) await fs.unlink(downloaded.filePath).catch(() => {})
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
    const canRetryHttp =
      looksLikeSslProtocolError(error) &&
      isLikelyInternalServiceUrl(args.baseUrl)

    if (!canRetryHttp) throw error

    const httpBase = forceHttp(args.baseUrl)
    const retryUrl = new URL('/api/discord_imports/images', httpBase).toString()

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
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'X-Forwarded-Proto': 'https'
    },
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
  // The link comes from a message, so it may only lead to the public internet.
  const resp = await fetchPublic(src.url)
  const contentType = (resp.contentType || (src.kind === 'attachment' ? src.contentType : '') || '').toLowerCase()
  if (!resp.ok || !contentType.startsWith('image/')) {
    resp.body.destroy()
    return null
  }

  const ext = extensionFor(contentType, src)
  const tmpPath = resolve(spoolDir, `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`)

  const hasher = createHash('sha256')
  let bytes = 0

  const nodeStream = resp.body
  nodeStream.on('data', (chunk: Buffer) => {
    bytes += chunk.length
    if (bytes > MAX_IMAGE_BYTES) {
      nodeStream.destroy(new Error(`Image exceeds the maximum allowed size of ${MAX_IMAGE_BYTES} bytes.`))
      return
    }
    hasher.update(chunk)
  })

  try {
    await pipeline(nodeStream, createWriteStream(tmpPath))
  } catch (e) {
    await fs.unlink(tmpPath).catch(() => {})
    throw e
  }
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
