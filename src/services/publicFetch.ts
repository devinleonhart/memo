import { lookup as dnsLookup } from 'dns'
import http from 'http'
import https from 'https'
import { isIP } from 'net'
import type { Readable } from 'stream'

// Fetches a link that a Discord user gave, and nothing inside this network: every
// address that a name resolves to must be public, the connection goes to an address
// that was checked, and each redirect is checked again.

const MAX_REDIRECTS = 3
const TIMEOUT_MS = 15_000
const REDIRECTS = [301, 302, 303, 307, 308]

export class RefusedUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RefusedUrlError'
  }
}

export type PublicResponse = { status: number; ok: boolean; contentType: string; body: Readable }

export type PublicFetchOptions = {
  isPublic?: (address: string) => boolean
  lookup?: typeof dnsLookup
  timeoutMs?: number
}

export function isPublicAddress(address: string): boolean {
  const version = isIP(address)
  if (version === 4) return isPublicV4(address.split('.').map(Number))
  if (version === 6) return isPublicV6(address)
  return false
}

function isPublicV4([a, b, c]: number[]): boolean {
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false
  if (a === 100 && b >= 64 && b <= 127) return false // shared address space, Tailscale among it
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 168) return false
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false
  if (a === 198 && (b === 18 || b === 19)) return false
  if (a === 198 && b === 51 && c === 100) return false
  if (a === 203 && b === 0 && c === 113) return false
  return true
}

function isPublicV6(address: string): boolean {
  const groups = groupsOf(address)
  if (!groups) return false
  if (groups.slice(0, 5).every((group) => group === 0)) {
    // Only an IPv4 address written as IPv6 can be public here; the rest is loopback and the like.
    if (groups[5] !== 0xffff) return false
    return isPublicV4([groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff])
  }
  const first = groups[0]
  if ((first & 0xe000) !== 0x2000) return false // outside global unicast: local, link-local, multicast
  if (first === 0x2001 && (groups[1] === 0xdb8 || groups[1] === 0)) return false // documentation, Teredo
  if (first === 0x2002) return false // 6to4, which holds an IPv4 address
  return true
}

function groupsOf(address: string): number[] | null {
  if (address.includes('%')) return null
  let text = address.toLowerCase()
  const dotted = text.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number)
    text =
      text.slice(0, dotted.index) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16)
  }
  const [head, tail] = text.split('::')
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  const middle = tail === undefined ? [] : new Array(8 - left.length - right.length).fill('0')
  const groups = [...left, ...middle, ...right].map((group) => parseInt(group, 16))
  return groups.length === 8 && groups.every((group) => group >= 0 && group <= 0xffff)
    ? groups
    : null
}

export async function fetchPublic(
  link: string,
  options: PublicFetchOptions = {}
): Promise<PublicResponse> {
  const isPublic = options.isPublic ?? isPublicAddress
  let url = parse(link)

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    check(url, isPublic)
    const response = await request(url, isPublic, options)
    const location = response.headers.location
    if (!REDIRECTS.includes(response.statusCode ?? 0) || !location) {
      const status = response.statusCode ?? 0
      const contentType = String(response.headers['content-type'] ?? '')
      return { status, ok: status >= 200 && status < 300, contentType, body: response }
    }
    response.resume()
    url = parse(location, url)
  }
  throw new RefusedUrlError('Too many redirects')
}

function parse(link: string, base?: URL): URL {
  try {
    return new URL(link, base)
  } catch {
    throw new RefusedUrlError('Not a link')
  }
}

function check(url: URL, isPublic: (address: string) => boolean): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new RefusedUrlError('Only http and https links')
  if (url.username || url.password) throw new RefusedUrlError('Links with a password are refused')
  // Node asks no resolver for an address, so it is checked here.
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host) && !isPublic(host)) throw new RefusedUrlError('Not a public address')
}

async function request(
  url: URL,
  isPublic: (address: string) => boolean,
  options: PublicFetchOptions
): Promise<http.IncomingMessage> {
  const resolve = options.lookup ?? dnsLookup
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS

  // The connection uses what this returns, so a name cannot resolve differently after the check.
  const lookup = (hostname: string, lookupOptions: any, callback: any): void => {
    resolve(hostname, { ...lookupOptions, all: true }, (error: any, found: any) => {
      if (error) return callback(error)
      const addresses: Array<{ address: string; family: number }> = found
      if (addresses.length === 0 || !addresses.every((one) => isPublic(one.address))) {
        return callback(new RefusedUrlError('Not a public address'))
      }
      if (lookupOptions?.all) callback(null, addresses)
      else callback(null, addresses[0].address, addresses[0].family)
    })
  }

  return await new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http
    const outgoing = client.request(url, {
      lookup: lookup as any,
      agent: false,
      timeout: timeoutMs,
      headers: { accept: 'image/*' }
    })
    outgoing.on('response', resolve)
    outgoing.on('timeout', () => outgoing.destroy(new Error('The link timed out')))
    outgoing.on('error', reject)
    outgoing.end()
  })
}
