import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createAdminClient, json, preflight, sha256 } from '../_shared/runtime.ts'
import { assertAudioFile, assertVoiceQuota, resolveVoiceSettings, transcribeAudio } from '../_shared/voice.ts'

type JsonObject = Record<string, unknown>
const clean = (value: FormDataEntryValue | null, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const parseJsonObject = (value: string) => { try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as JsonObject : {} } catch { return {} } }

Deno.serve(async (req: Request) => {
  const cors = preflight(req)
  if (cors) return cors
  if (req.method !== 'POST') return json({ success: false, error: 'method_not_allowed' }, 405)
  const authorization = req.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ai_live_')) return json({ success: false, error: 'invalid_api_key' }, 401)

  const admin = createAdminClient()
  let storagePath = ''
  try {
    const token = authorization.slice(7)
    const keyHash = await sha256(token)
    const clientResult = await admin.from('api_clients')
      .select('id,organization_id,is_active,capabilities,organizations!inner(is_active)')
      .eq('api_key_hash', keyHash)
      .single()
    const client = clientResult.data
    if (clientResult.error || !client || !client.is_active) return json({ success: false, error: 'invalid_api_key' }, 401)
    const organization = client.organizations as unknown as { is_active: boolean }
    if (!organization.is_active) return json({ success: false, error: 'organization_disabled' }, 403)
    const capabilities = Array.isArray(client.capabilities) ? client.capabilities as string[] : []
    if (!capabilities.includes('chat')) return json({ success: false, error: 'capability_not_allowed' }, 403)

    const form = await req.formData()
    const audio = form.get('audio')
    if (!(audio instanceof File)) return json({ success: false, error: 'audio_file_required' }, 400)
    const audioInfo = assertAudioFile(audio)
    const durationMs = Number(clean(form.get('durationMs'), 12))
    const channel = clean(form.get('channel'), 40) || 'voice'
    const externalCustomerId = clean(form.get('customerExternalId'), 220)
    const externalConversationId = clean(form.get('conversationExternalId'), 220)
    const externalMessageId = clean(form.get('messageExternalId'), 220)
    if (!externalCustomerId || !externalConversationId || !externalMessageId) return json({ success: false, error: 'voice_identifiers_required' }, 400)
    const language = clean(form.get('language'), 4) === 'en' ? 'en' : clean(form.get('language'), 4) === 'ar' ? 'ar' : null

    const existing = await admin.from('messages')
      .select('id,content,conversation_id')
      .eq('organization_id', client.organization_id)
      .eq('external_message_id', externalMessageId)
      .maybeSingle()
    if (existing.error) throw existing.error

    const context = parseJsonObject(clean(form.get('contextJson'), 16000))
    const customer = {
      externalId: externalCustomerId,
      name: clean(form.get('customerName'), 160) || undefined,
      email: clean(form.get('customerEmail'), 240) || null,
      phone: clean(form.get('customerPhone'), 80) || undefined,
      language: language ?? undefined,
      metadata: {},
    }
    const callChat = async (transcript: string, voiceContext: JsonObject) => {
      const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/chat`, {
        method: 'POST',
        headers: { authorization, 'content-type': 'application/json' },
        body: JSON.stringify({
          channel,
          customer,
          conversation: { externalId: externalConversationId, metadata: {} },
          message: { externalId: externalMessageId, type: 'audio', text: transcript },
          context: { ...context, voice: voiceContext },
        }),
        signal: AbortSignal.timeout(50000),
      })
      const payload = await response.json() as JsonObject
      if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : `chat_http_${response.status}`)
      return payload
    }

    if (existing.data?.content) {
      const attachment = await admin.from('message_attachments').select('storage_path,mime_type,duration_ms,transcript').eq('message_id', existing.data.id).maybeSingle()
      if (attachment.error) throw attachment.error
      const payload = await callChat(existing.data.content, { replay: true, storagePath: attachment.data?.storage_path ?? null, mimeType: attachment.data?.mime_type ?? audio.type, durationMs: attachment.data?.duration_ms ?? durationMs })
      return json({ ...payload, transcript: attachment.data?.transcript ?? existing.data.content, voiceReplay: true })
    }

    const settings = await resolveVoiceSettings(admin, client.organization_id)
    await assertVoiceQuota(admin, client.organization_id, settings, durationMs)
    const transcription = await transcribeAudio(admin, settings, audio, durationMs, language)

    const now = new Date()
    storagePath = `${client.organization_id}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}.${audioInfo.extension}`
    const uploaded = await admin.storage.from('chat-media').upload(storagePath, audio, { contentType: audio.type, upsert: false, cacheControl: '0' })
    if (uploaded.error) throw uploaded.error

    const voiceContext: JsonObject = {
      storagePath,
      bucket: 'chat-media',
      mimeType: audio.type,
      byteSize: audio.size,
      durationMs,
      transcriptionProvider: transcription.provider,
      transcriptionModel: transcription.model,
    }
    const payload = await callChat(transcription.text, voiceContext)

    const inbound = await admin.from('messages')
      .select('id,conversation_id')
      .eq('organization_id', client.organization_id)
      .eq('external_message_id', externalMessageId)
      .single()
    if (inbound.error || !inbound.data) throw inbound.error ?? new Error('voice_message_not_stored')

    const attachment = await admin.from('message_attachments').insert({
      organization_id: client.organization_id,
      conversation_id: inbound.data.conversation_id,
      message_id: inbound.data.id,
      kind: 'audio',
      bucket: 'chat-media',
      storage_path: storagePath,
      mime_type: audio.type,
      byte_size: audio.size,
      duration_ms: durationMs,
      transcript: transcription.text,
      transcription_provider: transcription.provider,
      transcription_model: transcription.model,
      input_tokens: transcription.inputTokens,
      output_tokens: transcription.outputTokens,
      estimated_cost: transcription.estimatedCost,
    })
    if (attachment.error) throw attachment.error

    await admin.from('usage_logs').insert({
      organization_id: client.organization_id,
      api_client_id: client.id,
      conversation_id: inbound.data.conversation_id,
      message_id: inbound.data.id,
      operation: 'voice_transcription',
      provider: transcription.provider,
      model: transcription.model,
      input_tokens: transcription.inputTokens,
      output_tokens: transcription.outputTokens,
      estimated_cost: transcription.estimatedCost,
      latency_ms: transcription.latencyMs,
    })

    storagePath = ''
    return json({ ...payload, transcript: transcription.text, voice: { durationMs, mimeType: audio.type } })
  } catch (error) {
    if (storagePath) await admin.storage.from('chat-media').remove([storagePath]).catch(() => undefined)
    const message = error instanceof Error ? error.message : 'voice_message_failed'
    const status = message === 'voice_not_enabled' ? 403
      : message === 'voice_monthly_limit_exceeded' || message === 'voice_duration_exceeded' ? 429
      : message === 'unsupported_audio_type' || message === 'audio_file_too_large' || message === 'voice_duration_required' ? 400
      : message.includes('voice_provider') ? 503 : 500
    return json({ success: false, error: message }, status)
  }
})
