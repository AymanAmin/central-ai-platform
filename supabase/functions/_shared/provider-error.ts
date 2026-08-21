export type AiProviderFailureKind = 'rate_limit' | 'quota' | 'unavailable' | 'auth' | 'other'

export class AiProviderRequestError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number,
    readonly kind: AiProviderFailureKind,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(`chat_provider_error:${provider}:${status}:${kind}`)
    this.name = 'AiProviderRequestError'
  }
}

const parseRetryAfter = (response: Response): number | null => {
  const raw = response.headers.get('retry-after')?.trim()
  if (!raw) return null
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds)
  const timestamp = Date.parse(raw)
  if (Number.isNaN(timestamp)) return null
  return Math.max(0, Math.ceil((timestamp - Date.now()) / 1000))
}

const classify = (status: number, body: string): AiProviderFailureKind => {
  const text = body.toLowerCase()
  if (status === 401 || status === 403) return 'auth'
  if (status === 402) return 'quota'
  if (status === 429) {
    if (/resource_exhausted|quota|daily|per day|rpd|tpd|free.?tier|neurons|credit|billing limit/.test(text)) return 'quota'
    return 'rate_limit'
  }
  if (status >= 500) return 'unavailable'
  return 'other'
}

export async function providerRequestError(provider: string, response: Response): Promise<AiProviderRequestError> {
  const body = (await response.text().catch(() => '')).slice(0, 2048)
  return new AiProviderRequestError(provider, response.status, classify(response.status, body), parseRetryAfter(response))
}

export const isFailoverEligibleProviderError = (error: unknown) => error instanceof AiProviderRequestError && error.kind !== 'other'

export const providerCooldownUntil = (error: AiProviderRequestError): Date => {
  const now = Date.now()
  if (error.kind === 'quota') {
    const nextUtcDay = new Date()
    nextUtcDay.setUTCHours(24, 0, 5, 0)
    return nextUtcDay
  }
  if (error.kind === 'auth') return new Date(now + 15 * 60_000)
  if (error.kind === 'unavailable') return new Date(now + 90_000)
  const retrySeconds = Math.min(Math.max(error.retryAfterSeconds ?? 60, 15), 300)
  return new Date(now + retrySeconds * 1000)
}
