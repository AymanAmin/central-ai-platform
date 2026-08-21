import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { ApiClientAuthError, authorizeApiClient } from '../_shared/api-client-auth.ts'
import { createAdminClient, json, preflight } from '../_shared/runtime.ts'
import { assertAudioFile, assertVoiceQuota, resolveVoiceSettings, transcribeAudio } from '../_shared/voice.ts'

type JsonObject = Record<string, unknown>
const clean = (value: FormDataEntryValue | null, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const parseJsonObject = (value: string) => {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as JsonObject : {}
  } catch {
    return {}
  }
}

Deno.serve(async (req: Request) => {
  const cors = preflight(req)
  if (cors) return cors
  if (req.method !== 'POST') return json({ success: false, error: 'method_not_allowed' }, 405)

  const admin = createAdminClient()
  let storagePath = ''

  try {
    const { authorization, client } = await authorizeApiClient(req, admin, 'chat')
    const form = await req.formData()
    const audio = form.get('audio')
    if (!(audio instanceof File)) return json({ success: false, error: 'audio_file_required' }, 400)

    const audioInfo = assertAudioFile(audio)
    const durationMs = Number(clean(form.get('durationMs'), 12))
    const channel = clean(form.get('channel'), 40) || 'voice'
    const externalCustomerId = clean(form.get('customerExternalId'), 220)
    const externalConversationId = clean(form.get('conversationExternalId'), 220)
    const externalMessageId = clean(form.get('messageExternalId'), 220)
    if (!externalCustomerId || !externalConversationId || !externalMessageId) {
      return json({ success: false, error: 'voice_identifiers_required' }, 400)
    }

    const language = clean(form.get('language'), 4) === 'en'
      ? 'en'
      : clean(form.get('language'), 4) === 'ar'
        ? 'ar'
        : null
    const existing = await admin
      .from('messages')
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
      const payload = await response.json().catch(() => ({ error: `chat_http_${response.status}` })) as JsonObject
      return { ok: response.ok, status: response.status, payload }
    }
    const callTts = async () => {
      try {
        const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/tts-reply`, {
          method: 'POST',
          headers: { authorization, 'content-type': 'application/json' },
          body: JSON.stringify({ externalMessageId }),
          signal: AbortSignal.timeout(20000),
        })
        const payload = await response.json().catch(() => null) as JsonObject | null
        return response.ok && payload?.generated === true && payload.audio ? payload.audio : null
      } catch {
        return null
      }
    }

    if (existing.data?.content) {
      const attachment = await admin
        .from('message_attachments')
        .select('storage_path,mime_type,duration_ms,transcript,original_audio_stored')
        .eq('message_id', existing.data.id)
        .eq('audio_source', 'customer_voice')
        .maybeSingle()
      if (attachment.error) throw attachment.error
      const transcript = attachment.data?.transcript ?? existing.data.content
      const chat = await callChat(transcript, {
        replay: true,
        storagePath: attachment.data?.storage_path ?? null,
        mimeType: attachment.data?.mime_type ?? audioInfo.mimeType,
        durationMs: attachment.data?.duration_ms ?? durationMs,
        originalAudioStored: Boolean(attachment.data?.original_audio_stored),
      })
      const voiceReply = chat.ok ? await callTts() : null
      return json({
        ...chat.payload,
        transcript,
        voiceReplay: true,
        voiceStored: Boolean(attachment.data?.original_audio_stored),
        voiceReply,
      }, chat.status)
    }

    const settings = await resolveVoiceSettings(admin, client.organization_id)
    await assertVoiceQuota(admin, client.organization_id, settings, durationMs)
    const transcription = await transcribeAudio(admin, settings, audio, durationMs, language)
    const storeOriginalAudio = settings.voice_retention_mode === 'audio_and_transcript'

    if (storeOriginalAudio) {
      const now = new Date()
      storagePath = `${client.organization_id}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}.${audioInfo.extension}`
      const uploaded = await admin.storage.from('chat-media').upload(storagePath, audio, {
        contentType: audioInfo.mimeType,
        upsert: false,
        cacheControl: '0',
      })
      if (uploaded.error) throw uploaded.error
    }

    const voiceContext: JsonObject = {
      storagePath: storeOriginalAudio ? storagePath : null,
      bucket: storeOriginalAudio ? 'chat-media' : null,
      mimeType: audioInfo.mimeType,
      byteSize: audio.size,
      durationMs,
      transcriptionProvider: transcription.provider,
      transcriptionModel: transcription.model,
      originalAudioStored: storeOriginalAudio,
      retentionMode: settings.voice_retention_mode,
    }
    const chat = await callChat(transcription.text, voiceContext)
    const inbound = await admin
      .from('messages')
      .select('id,conversation_id')
      .eq('organization_id', client.organization_id)
      .eq('external_message_id', externalMessageId)
      .maybeSingle()
    if (inbound.error) throw inbound.error
    if (!inbound.data) {
      if (!chat.ok) {
        const upstreamError = typeof chat.payload.error === 'string' ? chat.payload.error : `chat_http_${chat.status}`
        throw new Error(upstreamError)
      }
      throw new Error('voice_message_not_stored')
    }

    const attachment = await admin.from('message_attachments').insert({
      organization_id: client.organization_id,
      conversation_id: inbound.data.conversation_id,
      message_id: inbound.data.id,
      kind: 'audio',
      audio_source: 'customer_voice',
      bucket: storeOriginalAudio ? 'chat-media' : null,
      storage_path: storeOriginalAudio ? storagePath : null,
      original_audio_stored: storeOriginalAudio,
      mime_type: audioInfo.mimeType,
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

    const usage = await admin.from('usage_logs').insert({
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
    if (usage.error) throw usage.error

    storagePath = ''
    const voiceReply = chat.ok ? await callTts() : null
    if (!chat.ok) {
      return json({
        ...chat.payload,
        transcript: transcription.text,
        voice: { durationMs, mimeType: audioInfo.mimeType },
        voiceStored: storeOriginalAudio,
        voiceReply,
      }, chat.status)
    }
    return json({
      ...chat.payload,
      transcript: transcription.text,
      voice: { durationMs, mimeType: audioInfo.mimeType },
      voiceStored: storeOriginalAudio,
      voiceReply,
    })
  } catch (error) {
    if (storagePath) await admin.storage.from('chat-media').remove([storagePath]).catch(() => undefined)
    if (error instanceof ApiClientAuthError) return json({ success: false, error: error.message }, error.status)

    const message = error instanceof Error ? error.message : 'voice_message_failed'
    const status = message === 'voice_not_enabled'
      ? 403
      : ['voice_monthly_limit_exceeded', 'voice_duration_exceeded', 'message_monthly_limit_exceeded', 'ai_cost_limit_exceeded'].includes(message)
        ? 429
        : ['unsupported_audio_type', 'audio_file_too_large', 'voice_duration_required'].includes(message)
          ? 400
          : message.includes('voice_provider')
            ? 503
            : 500
    return json({ success: false, error: message }, status)
  }
})
