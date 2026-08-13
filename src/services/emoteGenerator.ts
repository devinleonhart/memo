// Client for the emote generator service (https://emote.devleo.me).
//
// The emote generator builds a composited PNG from a character plus a choice
// for each face part. It exposes:
//   GET /emote?character=&head=&eyebrows=&eyes=&mouth=  -> image/png
//   GET /character                                      -> string[] of characters
//   GET /part/:character                                -> string[] of part filenames
//
// Part filenames look like `clive_eyes_normal.png`, i.e.
// `<character>_<partKey>_<name>.png`.

export type PartKey = 'head' | 'eyebrows' | 'eyes' | 'mouth'

export const PART_KEYS: PartKey[] = ['head', 'eyebrows', 'eyes', 'mouth']

export interface EmoteConfig {
  character: string
  head: string
  eyebrows: string
  eyes: string
  mouth: string
}

const DEFAULT_BASE_URL = 'https://emote.devleo.me'
const REQUEST_TIMEOUT_MS = 2500

export function getEmoteBaseUrl (): string {
  const raw = process.env.EMOTE_BASE_URL?.trim()
  const base = raw && raw.length > 0 ? raw : DEFAULT_BASE_URL
  return base.replace(/\/+$/, '')
}

export function buildEmoteUrl (config: EmoteConfig, baseUrl = getEmoteBaseUrl()): string {
  const url = new URL(`${baseUrl.replace(/\/+$/, '')}/emote`)
  url.searchParams.set('character', config.character)
  url.searchParams.set('head', config.head)
  url.searchParams.set('eyebrows', config.eyebrows)
  url.searchParams.set('eyes', config.eyes)
  url.searchParams.set('mouth', config.mouth)
  return url.toString()
}

// Split `clive_eyes_normal.png` into its pieces. The name may itself contain
// underscores, so everything after the part key is treated as the name.
export function parsePartFilename (
  filename: string
): { character: string, key: string, name: string } | null {
  const base = filename.replace(/\.png$/i, '')
  const [character, key, ...rest] = base.split('_')
  if (!character || !key || rest.length === 0) return null
  return { character, key, name: rest.join('_') }
}

async function fetchJson (path: string): Promise<unknown> {
  const url = `${getEmoteBaseUrl()}${path}`
  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  if (!response.ok) {
    throw new Error(`Emote generator request failed: ${response.status} ${response.statusText}`)
  }
  return await response.json()
}

export async function fetchCharacters (): Promise<string[]> {
  const data = await fetchJson('/character')
  return Array.isArray(data) ? data.filter((c): c is string => typeof c === 'string') : []
}

// Returns the available part names for a character, grouped by part key,
// e.g. { head: ['normal'], eyes: ['normal', 'glee', ...], ... }.
export async function fetchPartsForCharacter (
  character: string
): Promise<Record<string, string[]>> {
  const data = await fetchJson(`/part/${encodeURIComponent(character.toLowerCase())}`)
  const grouped: Record<string, string[]> = {}
  if (!Array.isArray(data)) return grouped

  for (const entry of data) {
    if (typeof entry !== 'string') continue
    const parsed = parsePartFilename(entry)
    if (!parsed) continue
    ;(grouped[parsed.key] ??= []).push(parsed.name)
  }

  for (const key of Object.keys(grouped)) {
    grouped[key].sort()
  }
  return grouped
}

// Validates a combination by asking the generator to build it. Resolves with
// null on success, or a human-readable error message on failure.
export async function validateEmote (config: EmoteConfig): Promise<string | null> {
  const url = buildEmoteUrl(config)
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    if (response.ok) return null
    const detail = response.statusText?.trim()
    return detail && detail.length > 0
      ? detail
      : `The emote generator returned status ${response.status}.`
  } catch (error) {
    return error instanceof Error ? error.message : 'Could not reach the emote generator.'
  }
}
