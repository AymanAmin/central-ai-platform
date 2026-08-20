import { resolve4, resolve6 } from 'node:dns/promises'

const MAX_URL_BYTES = 2 * 1024 * 1024
const MAX_REDIRECTS = 3
const TOTAL_TIMEOUT_MS = 15_000

export interface KnowledgeUrlResult {
  text: string
  finalUrl: string
  contentType: string
  pageTitle: string | null
}

const blockedHostSuffixes = ['.localhost', '.local', '.internal', '.lan', '.home.arpa']

function normalizeHost(hostname: string) {
  return hostname.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '')
}

function isUnsafeIpv4(value: string) {
  const parts = value.split('.').map(Number)
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false
  const [a, b, c] = parts
  return a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
}

function isUnsafeIpv6(value: string) {
  const ip = value.toLowerCase()
  if (ip === '::' || ip === '::1') return true
  if (ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('ff')) return true
  if (/^fe[89ab]/.test(ip)) return true
  if (ip.startsWith('2001:db8:')) return true
  if (ip.startsWith('::ffff:')) return isUnsafeIpv4(ip.slice('::ffff:'.length))
  return false
}

function isUnsafeIp(value: string) {
  return value.includes(':') ? isUnsafeIpv6(value) : isUnsafeIpv4(value)
}

function isIpLiteral(host: string) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':')
}

async function assertPublicHost(hostname: string) {
  const host = normalizeHost(hostname)
  if (!host || host === 'localhost' || blockedHostSuffixes.some(suffix => host.endsWith(suffix))) {
    throw new Error('url_private_host_blocked')
  }

  if (isIpLiteral(host)) {
    if (isUnsafeIp(host)) throw new Error('url_private_address_blocked')
    return
  }

  const [a4, a6] = await Promise.allSettled([resolve4(host), resolve6(host)])
  const addresses = [
    ...(a4.status === 'fulfilled' ? a4.value : []),
    ...(a6.status === 'fulfilled' ? a6.value : []),
  ]
  if (!addresses.length) throw new Error('url_dns_resolution_failed')
  if (addresses.some(isUnsafeIp)) throw new Error('url_private_address_blocked')
}

async function assertSafeUrl(url: URL) {
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('url_protocol_not_allowed')
  if (url.username || url.password) throw new Error('url_credentials_not_allowed')
  if (url.port && !((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80'))) {
    throw new Error('url_port_not_allowed')
  }
  if (url.href.length > 2048) throw new Error('url_too_long')
  await assertPublicHost(url.hostname)
}

function decodeHtmlEntities(value: string) {
  const named: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', laquo: '«', raquo: '»',
  }
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16)
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }
    return named[entity.toLowerCase()] ?? match
  })
}

function normalizeVisibleText(value: string) {
  return value
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function extractHtmlText(html: string) {
  const pageTitleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)
  const pageTitle = pageTitleMatch ? normalizeVisibleText(decodeHtmlEntities(pageTitleMatch[1].replace(/<[^>]+>/g, ' '))) : null
  const withoutNoise = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|canvas|iframe|form|template)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(p|div|section|article|main|header|footer|nav|aside|li|h[1-6]|tr|td|th)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<[^>]+>/g, ' ')
  return { text: normalizeVisibleText(decodeHtmlEntities(withoutNoise)), pageTitle }
}

async function readLimitedBody(response: Response) {
  const declared = Number(response.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_URL_BYTES) throw new Error('url_content_too_large')
  if (!response.body) throw new Error('url_empty_response')

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > MAX_URL_BYTES) {
      await reader.cancel()
      throw new Error('url_content_too_large')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

export async function fetchKnowledgeUrl(rawUrl: string): Promise<KnowledgeUrlResult> {
  let current: URL
  try {
    current = new URL(rawUrl)
  } catch {
    throw new Error('invalid_source_url')
  }

  const deadline = Date.now() + TOTAL_TIMEOUT_MS
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    await assertSafeUrl(current)
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new Error('url_fetch_timeout')

    let response: Response
    try {
      response = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          accept: 'text/html,text/plain,application/xhtml+xml;q=0.9',
          'accept-language': 'ar,en;q=0.8',
          'user-agent': 'CentralAIKnowledgeFetcher/1.0',
        },
        signal: AbortSignal.timeout(Math.max(1000, remaining)),
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') throw new Error('url_fetch_timeout')
      throw new Error('url_fetch_failed')
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      if (!location) throw new Error('url_redirect_without_location')
      if (redirectCount >= MAX_REDIRECTS) throw new Error('url_too_many_redirects')
      current = new URL(location, current)
      continue
    }
    if (!response.ok) throw new Error(`url_http_error:${response.status}`)

    const contentType = (response.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase()
    if (!['text/html', 'text/plain', 'application/xhtml+xml'].includes(contentType)) throw new Error('url_unsupported_content_type')
    const raw = await readLimitedBody(response)
    const extracted = contentType === 'text/plain'
      ? { text: normalizeVisibleText(raw), pageTitle: null }
      : extractHtmlText(raw)
    if (extracted.text.length < 20) throw new Error('url_no_extractable_text')

    return {
      text: extracted.text,
      finalUrl: current.toString(),
      contentType,
      pageTitle: extracted.pageTitle,
    }
  }
  throw new Error('url_too_many_redirects')
}
