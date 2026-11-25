import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { fetchPublic, isPublicAddress, RefusedUrlError } from '../src/services/publicFetch'

async function text(body: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of body) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString()
}

describe('isPublicAddress', () => {
  it('refuses addresses that are not on the public internet', () => {
    const refused = [
      '127.0.0.1',
      '127.255.255.254',
      '0.0.0.0',
      '10.0.0.1',
      '10.50.50.2',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '100.127.255.255',
      '192.0.0.1',
      '192.0.2.1',
      '198.18.0.1',
      '198.51.100.1',
      '203.0.113.1',
      '224.0.0.1',
      '240.0.0.1',
      '255.255.255.255',
      '::',
      '::1',
      'fc00::1',
      'fd7a:115c:a1e0::1',
      'fe80::1',
      'ff02::1',
      '2001:db8::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '::ffff:10.0.0.1',
      '::127.0.0.1',
      '64:ff9b::7f00:1',
      '2002:7f00:1::1',
      '2001::1',
      'fe80::1%eth0',
      'blackbook',
      '',
      'not an address',
      '1.2.3',
      '0x7f.0.0.1'
    ]
    for (const address of refused) expect(isPublicAddress(address), address).toBe(false)
  })

  it('accepts public addresses', () => {
    const accepted = [
      '1.1.1.1',
      '8.8.8.8',
      '100.63.255.255',
      '100.128.0.1',
      '172.15.0.1',
      '172.32.0.1',
      '192.167.1.1',
      '162.159.130.233',
      '2606:4700:4700::1111',
      '2a00:1450:4001::200e',
      '::ffff:1.1.1.1'
    ]
    for (const address of accepted) expect(isPublicAddress(address), address).toBe(true)
  })
})

describe('fetchPublic', () => {
  let server: http.Server
  let base: string
  let hits: string[] = []
  const local = { isPublic: (address: string) => address === '127.0.0.1' }
  const resolveTo = (address: string) =>
    ((_host: string, options: any, callback: any) => {
      if (options?.all) callback(null, [{ address, family: 4 }])
      else callback(null, address, 4)
    }) as any

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      hits.push(req.url ?? '')
      if (req.url === '/image') {
        res.writeHead(200, { 'content-type': 'image/png' }).end('picture')
      } else if (req.url === '/loop') {
        res.writeHead(302, { location: '/loop' }).end()
      } else if (req.url === '/hop') {
        res.writeHead(301, { location: '/image' }).end()
      } else if (req.url === '/inside') {
        res.writeHead(302, { location: 'http://10.1.2.3/secret' }).end()
      } else if (req.url === '/inside-name') {
        res.writeHead(307, { location: 'http://blackbook:3000/api' }).end()
      } else if (req.url === '/file') {
        res.writeHead(302, { location: 'file:///etc/passwd' }).end()
      } else if (req.url === '/slow') {
        // never answers
      } else {
        res.writeHead(404).end('no')
      }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })

  it('gets a picture, also after a redirect', async () => {
    for (const path of ['/image', '/hop']) {
      const response = await fetchPublic(base + path, local)
      expect([response.status, response.ok, response.contentType]).toEqual([200, true, 'image/png'])
      expect(await text(response.body)).toBe('picture')
    }
  })

  it('reports other statuses', async () => {
    const response = await fetchPublic(`${base}/missing`, local)
    expect([response.status, response.ok]).toEqual([404, false])
    response.body.resume()
  })

  it('refuses addresses inside the network, without a request', async () => {
    hits = []
    const urls = [
      `${base}/image`,
      'http://localhost/',
      'http://[::1]/',
      'http://10.0.0.1/',
      'http://169.254.169.254/latest',
      'http://[::ffff:127.0.0.1]/',
      'http://2130706433/',
      'http://0x7f000001/',
      'http://127.1/',
      'http://0/'
    ]
    for (const url of urls) {
      await expect(fetchPublic(url), url).rejects.toBeInstanceOf(RefusedUrlError)
    }
    expect(hits).toEqual([])
  })

  it('refuses names that resolve inside the network', async () => {
    for (const address of ['127.0.0.1', '10.0.0.5', '172.18.0.3', '100.100.1.1']) {
      await expect(
        fetchPublic('http://blackbook:3000/x', { lookup: resolveTo(address) })
      ).rejects.toBeInstanceOf(RefusedUrlError)
    }
  })

  it('refuses a name with any address inside the network', async () => {
    const lookup = ((_host: string, _options: any, callback: any) => {
      callback(null, [
        { address: '1.1.1.1', family: 4 },
        { address: '127.0.0.1', family: 4 }
      ])
    }) as any
    await expect(fetchPublic('http://mixed.example/x', { lookup })).rejects.toBeInstanceOf(
      RefusedUrlError
    )
  })

  it('connects to the address that it checked', async () => {
    hits = []
    const port = (server.address() as AddressInfo).port
    const response = await fetchPublic(`http://pictures.example:${port}/image`, {
      ...local,
      lookup: resolveTo('127.0.0.1')
    })
    expect(await text(response.body)).toBe('picture')
    expect(hits).toEqual(['/image'])
  })

  it('checks every redirect', async () => {
    for (const path of ['/inside', '/inside-name', '/file']) {
      const options = { ...local, lookup: resolveTo('172.18.0.3') } // as Docker resolves a neighbor's name
      await expect(fetchPublic(base + path, options), path).rejects.toBeInstanceOf(RefusedUrlError)
    }
  })

  it('follows few redirects', async () => {
    hits = []
    await expect(fetchPublic(`${base}/loop`, local)).rejects.toBeInstanceOf(RefusedUrlError)
    expect(hits.length).toBe(4)
  })

  it('refuses other schemes, credentials and nonsense', async () => {
    for (const url of [
      'file:///etc/passwd',
      'ftp://example.com/a.png',
      'gopher://example.com/',
      'data:image/png;base64,AAAA',
      'http://user:secret@example.com/a.png',
      'not a url',
      '',
      'http://'
    ]) {
      await expect(fetchPublic(url, local), url).rejects.toBeInstanceOf(RefusedUrlError)
    }
  })

  it('gives up on a server that does not answer', async () => {
    await expect(fetchPublic(`${base}/slow`, { ...local, timeoutMs: 200 })).rejects.toThrow(
      /timed out/
    )
  })
})
