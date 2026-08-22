import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createAdminClient, json, preflight } from '../_shared/runtime.ts'

type JsonObject = Record<string, unknown>
interface RequestBody { apiClientId?: string; payload?: JsonObject }

const MAX_PAYLOAD_BYTES = 32 * 1024
const isObject = (value: unknown): value is JsonObject => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const clean = (value: unknown, max = 220) => typeof value === 'string' ? value.trim().slice(0, max) : ''

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
    const apiClientId = clean(body.apiClientId, 80)
    if (!apiClientId) return json({ success: false, error: 'api_client_required' }, 400)
    if (!isObject(body.payload)) return json({ success: false, error: 'payload_required' }, 400)

    const serialized = JSON.stringify(body.payload)
    if (new TextEncoder().encode(serialized).byteLength > MAX_PAYLOAD_BYTES) {
      return json({ success: false, error: 'payload_too_large' }, 413)
    }

    const clientResult = await admin.from('api_clients').select('id,organization_id,name,code,is_active,capabilities').eq('id', apiClientId).maybeSingle()
    const client = clientResult.data
    if (clientResult.error) throw clientResult.error
    if (!client?.is_active) return json({ success: false, error: 'api_client_not_found_or_inactive' }, 404)
    if (profile.data.role !== 'SUPER_ADMIN' && client.organization_id !== profile.data.organization_id) {
      return json({ success: false, error: 'api_client_outside_organization' }, 403)
    }

    const capabilities = Array.isArray(client.capabilities) ? client.capabilities.filter((value): value is string => typeof value === 'string') : []
    if (!capabilities.includes('chat')) return json({ success: false, error: 'capability_not_allowed' }, 400)

    const message = isObject(body.payload.message) ? body.payload.message : null
    const conversation = isObject(body.payload.conversation) ? body.payload.conversation : null
    const context = isObject(body.payload.context) ? body.payload.context : {}
    const question = clean(message?.text, 16_000)
    const conversationExternalId = clean(conversation?.externalId, 320)
    if (!question) return json({ success: false, error: 'message_text_required' }, 400)

    const requestedKnowledgeBaseId = capabilities.includes('select_knowledge_base') ? clean(context.knowledgeBaseId, 80) || null : null
    const url = Deno.env.get('SUPABASE_URL')
    if (!url) throw new Error('supabase_url_missing')

    const started = performance.now()
    const response = await fetch(`${url}/functions/v1/playground`, {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ organizationId: client.organization_id, knowledgeBaseId: requestedKnowledgeBaseId, question }),
      signal: AbortSignal.timeout(60_000),
    })
    const text = await response.text()
    let preview: unknown = text
    try { preview = text ? JSON.parse(text) : null } catch { /* Keep text diagnostics. */ }

    const latencyMs = Math.round(performance.now() - started)
    if (!response.ok || !isObject(preview) || preview.success !== true) {
      return json({
        success: true,
        requestOk: false,
        upstreamStatus: response.status,
        latencyMs,
        previewMode: 'non_persistent',
        response: preview,
      })
    }

    const externalShape = {
      success: true,
      conversationId: conversationExternalId || null,
      answer: typeof preview.answer === 'string' ? preview.answer : '',
      intent: typeof preview.intent === 'string' ? preview.intent : 'unknown',
      requestHuman: false,
      actions: [],
      confidence: typeof preview.confidence === 'number' ? preview.confidence : null,
      sources: Array.isArray(preview.sources) ? preview.sources : [],
      provider: typeof preview.provider === 'string' ? preview.provider : null,
      model: typeof preview.model === 'string' ? preview.model : null,
      usage: isObject(preview.usage) ? preview.usage : null,
    }

    return json({
      success: true,
      requestOk: true,
      upstreamStatus: 200,
      latencyMs,
      previewMode: 'non_persistent',
      apiClient: { id: client.id, name: client.name, code: client.code },
      response: externalShape,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'integration_test_failed'
    return json({ success: false, error: message }, message.includes('TimeoutError') ? 504 : 500)
  }
})
