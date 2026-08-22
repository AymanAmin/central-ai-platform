import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createAdminClient, json, preflight, sha256 } from '../_shared/runtime.ts'

type JsonObject = Record<string, unknown>
interface RequestBody { apiKey?: string; payload?: JsonObject }

const MAX_PAYLOAD_BYTES = 32 * 1024
const cleanKey = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const isObject = (value: unknown): value is JsonObject => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

Deno.serve(async (req: Request) => {
  const cors = preflight(req)
  if (cors) return cors
  if (req.method !== 'POST') return json({ success: false, error: 'method_not_allowed' }, 405)

  try {
    const authorization = req.headers.get('authorization')
    if (!authorization?.startsWith('Bearer ')) return json({ success: false, error: 'unauthorized' }, 401)

    const admin = createAdminClient()
    const user = await admin.auth.getUser(authorization.slice(7))
    if (user.error || !user.data.user) return json({ success: false, error: 'unauthorized' }, 401)

    const profile = await admin.from('profiles').select('organization_id,role,is_active').eq('id', user.data.user.id).single()
    if (profile.error || !profile.data?.is_active || !['SUPER_ADMIN', 'ORGANIZATION_ADMIN'].includes(profile.data.role)) {
      return json({ success: false, error: 'forbidden' }, 403)
    }

    const body = await req.json() as RequestBody
    const apiKey = cleanKey(body.apiKey)
    if (!apiKey.startsWith('ai_live_') || apiKey.length < 24 || apiKey.length > 256) {
      return json({ success: false, error: 'invalid_api_key_format' }, 400)
    }
    if (!isObject(body.payload)) return json({ success: false, error: 'payload_required' }, 400)

    const serialized = JSON.stringify(body.payload)
    if (new TextEncoder().encode(serialized).byteLength > MAX_PAYLOAD_BYTES) {
      return json({ success: false, error: 'payload_too_large' }, 413)
    }

    const keyHash = await sha256(apiKey)
    const client = await admin.from('api_clients').select('organization_id,is_active').eq('api_key_hash', keyHash).maybeSingle()
    if (client.error) throw client.error
    if (!client.data?.is_active) return json({ success: false, error: 'invalid_api_key' }, 400)
    if (profile.data.role !== 'SUPER_ADMIN' && client.data.organization_id !== profile.data.organization_id) {
      return json({ success: false, error: 'api_key_outside_organization' }, 403)
    }

    const url = Deno.env.get('SUPABASE_URL')
    if (!url) throw new Error('supabase_url_missing')
    const started = performance.now()
    const response = await fetch(`${url}/functions/v1/chat`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: serialized,
      signal: AbortSignal.timeout(60_000),
    })
    const text = await response.text()
    let payload: unknown = text
    try { payload = text ? JSON.parse(text) : null } catch { /* Keep a text response for diagnostics. */ }

    return json({
      success: true,
      requestOk: response.ok,
      upstreamStatus: response.status,
      latencyMs: Math.round(performance.now() - started),
      response: payload,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'integration_test_failed'
    return json({ success: false, error: message }, message.includes('TimeoutError') ? 504 : 500)
  }
})
