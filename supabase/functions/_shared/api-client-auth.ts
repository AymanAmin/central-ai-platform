import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.112.3'
import { sha256 } from './runtime.ts'

export interface AuthorizedApiClient {
  id: string
  organization_id: string
  rate_limit_per_minute: number
  capabilities: unknown
  allowed_ips: unknown
  organizations: unknown
}

export class ApiClientAuthError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiClientAuthError'
    this.status = status
  }
}

const callerIp = (req: Request) =>
  (req.headers.get('cf-connecting-ip') ?? req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for'))
    ?.split(',')[0]
    ?.trim() || null

export async function authorizeApiClient(
  req: Request,
  admin: SupabaseClient,
  requiredCapability = 'chat',
): Promise<{ authorization: string; client: AuthorizedApiClient }> {
  const authorization = req.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ai_live_')) throw new ApiClientAuthError('invalid_api_key', 401)

  const keyHash = await sha256(authorization.slice(7))
  const result = await admin
    .from('api_clients')
    .select('id,organization_id,is_active,rate_limit_per_minute,capabilities,allowed_ips,organizations!inner(is_active)')
    .eq('api_key_hash', keyHash)
    .single()
  const client = result.data as (AuthorizedApiClient & { is_active: boolean }) | null
  if (result.error || !client || !client.is_active) throw new ApiClientAuthError('invalid_api_key', 401)

  const organization = client.organizations as { is_active?: boolean } | null
  if (!organization?.is_active) throw new ApiClientAuthError('organization_disabled', 403)

  const capabilities = Array.isArray(client.capabilities)
    ? client.capabilities.filter((value): value is string => typeof value === 'string')
    : []
  if (!capabilities.includes(requiredCapability)) throw new ApiClientAuthError('capability_not_allowed', 403)

  const allowedIps = Array.isArray(client.allowed_ips)
    ? client.allowed_ips.filter((value): value is string => typeof value === 'string')
    : []
  if (allowedIps.length) {
    const ip = callerIp(req)
    if (!ip || !allowedIps.includes(ip)) throw new ApiClientAuthError('ip_not_allowed', 403)
  }

  const rate = await admin.rpc('consume_api_rate_limit', {
    p_api_client_id: client.id,
    p_limit: client.rate_limit_per_minute,
  })
  if (rate.error) throw rate.error
  if (!rate.data) throw new ApiClientAuthError('rate_limit_exceeded', 429)

  return { authorization, client }
}
