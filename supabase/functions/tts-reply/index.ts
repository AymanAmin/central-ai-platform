import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { ApiClientAuthError, authorizeApiClient } from '../_shared/api-client-auth.ts'
import { createAdminClient, json } from '../_shared/runtime.ts'
import { resolveVoiceSettings } from '../_shared/voice.ts'
import { assertTtsQuota, generateSpeech, shouldGenerateVoiceReply } from '../_shared/tts.ts'

type JsonObject = Record<string, unknown>
interface Body { externalMessageId?: string }
interface ExistingAttachment {
  id: string
  storage_path: string | null
  mime_type: string | null
  duration_ms: number | null
  generation_provider: string | null
  generation_voice: string | null
  created_at: string
}

const PENDING_PROVIDER = 'pending'
const STALE_RESERVATION_MS = 120_000
const clean = (value: string | undefined, max: number) => value?.trim().slice(0, max) ?? ''

async function signedAudio(admin: ReturnType<typeof createAdminClient>, storagePath: string) {
  const signed = await admin.storage.from('chat-media').createSignedUrl(storagePath, 300)
  if (signed.error || !signed.data?.signedUrl) throw signed.error ?? new Error('tts_signed_url_failed')
  return signed.data.signedUrl
}

async function findTtsAttachment(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  messageId: string,
) {
  return admin
    .from('message_attachments')
    .select('id,storage_path,mime_type,duration_ms,generation_provider,generation_voice,created_at')
    .eq('organization_id', organizationId)
    .eq('message_id', messageId)
    .eq('audio_source', 'assistant_tts')
    .maybeSingle()
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ success: false, error: 'method_not_allowed' }, 405)
  const admin = createAdminClient()
  let storagePath = ''
  let attachmentId = ''
  let usageId = ''

  try {
    const { client } = await authorizeApiClient(req, admin, 'chat')
    const body = await req.json() as Body
    const externalMessageId = clean(body.externalMessageId, 220)
    if (!externalMessageId) return json({ success: false, error: 'external_message_id_required' }, 400)

    const inbound = await admin
      .from('messages')
      .select('id,conversation_id')
      .eq('organization_id', client.organization_id)
      .eq('external_message_id', externalMessageId)
      .eq('role', 'user')
      .maybeSingle()
    if (inbound.error) throw inbound.error
    if (!inbound.data) return json({ success: true, generated: false, reason: 'inbound_message_not_found' })

    const customerVoice = await admin
      .from('message_attachments')
      .select('id')
      .eq('organization_id', client.organization_id)
      .eq('message_id', inbound.data.id)
      .eq('audio_source', 'customer_voice')
      .limit(1)
      .maybeSingle()
    if (customerVoice.error) throw customerVoice.error
    const source = customerVoice.data ? 'voice' : 'text'

    const settings = await resolveVoiceSettings(admin, client.organization_id)
    if (!shouldGenerateVoiceReply(settings, source)) {
      return json({ success: true, generated: false, reason: settings.voice_enabled ? 'reply_mode_text_only' : 'voice_disabled' })
    }

    const assistant = await admin
      .from('messages')
      .select('id,content,language')
      .eq('organization_id', client.organization_id)
      .eq('conversation_id', inbound.data.conversation_id)
      .eq('role', 'assistant')
      .contains('content_json', { requestMessageId: inbound.data.id })
      .maybeSingle()
    if (assistant.error) throw assistant.error
    if (!assistant.data?.content?.trim()) return json({ success: true, generated: false, reason: 'assistant_reply_not_found' })

    const language: 'ar' | 'en' = assistant.data.language === 'en' ? 'en' : 'ar'
    const replyAudio = async (existing: ExistingAttachment, idempotentReplay: boolean) => {
      if (!existing.storage_path) throw new Error('tts_storage_path_missing')
      const url = await signedAudio(admin, existing.storage_path)
      return json({
        success: true,
        generated: true,
        idempotentReplay,
        audio: {
          url,
          mimeType: existing.mime_type ?? 'audio/wav',
          durationMs: Number(existing.duration_ms ?? 0),
          voiceName: existing.generation_voice ?? settings.voice_tts_voice,
          language,
        },
      })
    }

    let existingResult = await findTtsAttachment(admin, client.organization_id, assistant.data.id)
    if (existingResult.error) throw existingResult.error
    let existing = existingResult.data as ExistingAttachment | null
    if (existing) {
      if (existing.generation_provider !== PENDING_PROVIDER) return replyAudio(existing, true)

      const createdAt = Date.parse(existing.created_at)
      const isStale = !Number.isFinite(createdAt) || Date.now() - createdAt > STALE_RESERVATION_MS
      if (!isStale) return json({ success: true, generated: false, reason: 'generation_in_progress' }, 202)

      const staleDelete = await admin
        .from('message_attachments')
        .delete()
        .eq('id', existing.id)
        .eq('organization_id', client.organization_id)
        .eq('generation_provider', PENDING_PROVIDER)
        .select('id')
        .maybeSingle()
      if (staleDelete.error) throw staleDelete.error
      if (!staleDelete.data) {
        existingResult = await findTtsAttachment(admin, client.organization_id, assistant.data.id)
        if (existingResult.error) throw existingResult.error
        existing = existingResult.data as ExistingAttachment | null
        if (existing?.generation_provider !== PENDING_PROVIDER && existing) return replyAudio(existing, true)
        return json({ success: true, generated: false, reason: 'generation_in_progress' }, 202)
      }
      if (existing.storage_path) await admin.storage.from('chat-media').remove([existing.storage_path])
    }

    await assertTtsQuota(admin, client.organization_id, settings)

    storagePath = `${client.organization_id}/tts/${assistant.data.id}.wav`
    const reservation = await admin
      .from('message_attachments')
      .insert({
        organization_id: client.organization_id,
        conversation_id: inbound.data.conversation_id,
        message_id: assistant.data.id,
        kind: 'audio',
        audio_source: 'assistant_tts',
        bucket: 'chat-media',
        storage_path: storagePath,
        original_audio_stored: true,
        mime_type: 'audio/wav',
        byte_size: 0,
        duration_ms: 0,
        generation_provider: PENDING_PROVIDER,
        generation_model: settings.voice_tts_model,
        generation_voice: settings.voice_tts_voice,
        input_tokens: 0,
        output_tokens: 0,
        estimated_cost: 0,
      })
      .select('id')
      .single()

    if (reservation.error) {
      if (reservation.error.code === '23505') {
        const raced = await findTtsAttachment(admin, client.organization_id, assistant.data.id)
        if (raced.error) throw raced.error
        const current = raced.data as ExistingAttachment | null
        if (current?.generation_provider !== PENDING_PROVIDER && current) return replyAudio(current, true)
        return json({ success: true, generated: false, reason: 'generation_in_progress' }, 202)
      }
      throw reservation.error
    }
    attachmentId = reservation.data.id

    const speech = await generateSpeech(admin, settings, assistant.data.content, language)
    if (settings.included_monthly_tts_minutes != null) {
      const start = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString()
      const used = await admin
        .from('message_attachments')
        .select('duration_ms')
        .eq('organization_id', client.organization_id)
        .eq('audio_source', 'assistant_tts')
        .gte('created_at', start)
      if (used.error) throw used.error
      const usedMs = (used.data ?? []).reduce((sum, row) => sum + Number(row.duration_ms ?? 0), 0)
      if (usedMs + speech.durationMs > settings.included_monthly_tts_minutes * 60000) throw new Error('tts_monthly_limit_exceeded')
    }

    const uploaded = await admin.storage.from('chat-media').upload(storagePath, speech.bytes, {
      contentType: speech.mimeType,
      upsert: false,
      cacheControl: '0',
    })
    if (uploaded.error) throw uploaded.error

    const usage = await admin
      .from('usage_logs')
      .insert({
        organization_id: client.organization_id,
        api_client_id: client.id,
        conversation_id: inbound.data.conversation_id,
        message_id: assistant.data.id,
        operation: 'voice_tts',
        provider: speech.provider,
        model: speech.model,
        input_tokens: speech.inputTokens,
        output_tokens: speech.outputTokens,
        estimated_cost: speech.estimatedCost,
        latency_ms: speech.latencyMs,
      })
      .select('id')
      .single()
    if (usage.error) throw usage.error
    usageId = usage.data.id

    const finalized = await admin
      .from('message_attachments')
      .update({
        byte_size: speech.bytes.length,
        duration_ms: speech.durationMs,
        generation_provider: speech.provider,
        generation_model: speech.model,
        generation_voice: speech.voiceName,
        input_tokens: speech.inputTokens,
        output_tokens: speech.outputTokens,
        estimated_cost: speech.estimatedCost,
      })
      .eq('id', attachmentId)
      .eq('organization_id', client.organization_id)
      .eq('generation_provider', PENDING_PROVIDER)
      .select('id')
      .maybeSingle()
    if (finalized.error) throw finalized.error
    if (!finalized.data) throw new Error('tts_reservation_lost')

    const url = await signedAudio(admin, storagePath)
    attachmentId = ''
    usageId = ''
    storagePath = ''
    return json({
      success: true,
      generated: true,
      audio: {
        url,
        mimeType: speech.mimeType,
        durationMs: speech.durationMs,
        voiceName: speech.voiceName,
        language,
      },
    })
  } catch (error) {
    if (usageId) await admin.from('usage_logs').delete().eq('id', usageId)
    if (attachmentId) await admin.from('message_attachments').delete().eq('id', attachmentId)
    if (storagePath) await admin.storage.from('chat-media').remove([storagePath]).catch(() => undefined)

    if (error instanceof ApiClientAuthError) return json({ success: false, error: error.message }, error.status)
    const message = error instanceof Error ? error.message : 'tts_reply_failed'
    const status = ['tts_monthly_limit_exceeded', 'ai_cost_limit_exceeded'].includes(message)
      ? 429
      : message.startsWith('tts_')
        ? 503
        : 500
    return json({ success: false, error: message } satisfies JsonObject, status)
  }
})
