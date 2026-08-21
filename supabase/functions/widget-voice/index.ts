import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createAdminClient } from '../_shared/runtime.ts'

type JsonObject = Record<string, unknown>
const clean = (value: FormDataEntryValue | null, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const originHeaders = (origin: string) => ({
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': origin || 'null',
  'access-control-allow-methods': 'POST,OPTIONS',
  'access-control-allow-headers': 'content-type,x-widget-key',
  'access-control-max-age': '600',
  'vary': 'Origin',
  'cache-control': 'no-store',
})
const send = (origin: string, payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: originHeaders(origin) })

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') ?? ''
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: originHeaders(origin) })
  if (req.method !== 'POST') return send(origin, { success: false, error: 'method_not_allowed' }, 405)
  const publicKey = (req.headers.get('x-widget-key') ?? '').trim().slice(0, 160)
  if (!/^ai_widget_[A-Za-z0-9_-]{24,}$/.test(publicKey)) return send(origin, { success: false, error: 'invalid_widget_key' }, 401)
  if (!origin) return send(origin, { success: false, error: 'widget_origin_required' }, 403)

  const admin = createAdminClient()
  try {
    const widgetResult = await admin.from('web_chat_widgets')
      .select('id,organization_id,api_client_id,prompt_profile_id,knowledge_base_id,allowed_origins,is_active')
      .eq('public_key', publicKey)
      .maybeSingle()
    const widget = widgetResult.data
    if (widgetResult.error || !widget?.is_active) return send(origin, { success: false, error: 'widget_not_found' }, 404)
    const allowed = Array.isArray(widget.allowed_origins) ? widget.allowed_origins.filter((value): value is string => typeof value === 'string') : []
    if (!allowed.includes(origin)) return send(origin, { success: false, error: 'widget_origin_not_allowed' }, 403)

    const form = await req.formData()
    const audio = form.get('audio')
    if (!(audio instanceof File)) return send(origin, { success: false, error: 'audio_file_required' }, 400)
    const visitorId = clean(form.get('visitorId'), 160)
    const conversationId = clean(form.get('conversationId'), 160)
    const messageId = clean(form.get('messageId'), 160)
    if (!visitorId || !conversationId || !messageId) return send(origin, { success: false, error: 'invalid_request' }, 400)

    const secret = await admin.rpc('get_web_widget_api_key', { p_widget_id: widget.id })
    if (secret.error || typeof secret.data !== 'string' || !secret.data.startsWith('ai_live_')) return send(origin, { success: false, error: 'widget_backend_unavailable' }, 503)

    const context: JsonObject = { widgetId: widget.id, sourceOrigin: origin, webWidget: true }
    if (widget.prompt_profile_id) context.promptProfileId = widget.prompt_profile_id
    if (widget.knowledge_base_id) context.knowledgeBaseId = widget.knowledge_base_id

    const upstream = new FormData()
    upstream.set('audio', audio, audio.name || 'voice')
    upstream.set('durationMs', clean(form.get('durationMs'), 12))
    upstream.set('channel', 'website')
    upstream.set('customerExternalId', `web:${widget.id}:${visitorId}`)
    upstream.set('conversationExternalId', `web:${widget.id}:${conversationId}`)
    upstream.set('messageExternalId', `web:${widget.id}:${messageId}`)
    upstream.set('language', clean(form.get('language'), 4))
    upstream.set('customerName', clean(form.get('customerName'), 160))
    upstream.set('customerEmail', clean(form.get('customerEmail'), 240))
    upstream.set('customerPhone', clean(form.get('customerPhone'), 80))
    upstream.set('contextJson', JSON.stringify(context))

    const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/voice-message`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret.data}` },
      body: upstream,
      signal: AbortSignal.timeout(60000),
    })
    const payload = await response.json() as JsonObject
    return send(origin, payload, response.status)
  } catch (error) {
    return send(origin, { success: false, error: 'widget_voice_failed', detail: error instanceof Error ? error.message : undefined }, 500)
  }
})
