import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createAdminClient, json, sha256 } from '../_shared/runtime.ts'
import { resolveVoiceSettings } from '../_shared/voice.ts'
import { assertTtsQuota, generateSpeech, shouldGenerateVoiceReply, type VoiceReplySource } from '../_shared/tts.ts'

type JsonObject = Record<string, unknown>
interface Body { externalMessageId?: string; source?: VoiceReplySource }
const clean = (value: string | undefined, max: number) => value?.trim().slice(0, max) ?? ''

async function signedAudio(admin: ReturnType<typeof createAdminClient>, storagePath: string) {
  const signed = await admin.storage.from('chat-media').createSignedUrl(storagePath, 300)
  if (signed.error || !signed.data?.signedUrl) throw signed.error ?? new Error('tts_signed_url_failed')
  return signed.data.signedUrl
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ success: false, error: 'method_not_allowed' }, 405)
  const authorization = req.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ai_live_')) return json({ success: false, error: 'invalid_api_key' }, 401)
  const admin = createAdminClient()
  let storagePath = ''
  try {
    const keyHash = await sha256(authorization.slice(7))
    const clientResult = await admin.from('api_clients').select('id,organization_id,is_active,organizations!inner(is_active)').eq('api_key_hash', keyHash).single()
    const client = clientResult.data
    if (clientResult.error || !client || !client.is_active) return json({ success: false, error: 'invalid_api_key' }, 401)
    const organization = client.organizations as unknown as { is_active: boolean }
    if (!organization.is_active) return json({ success: false, error: 'organization_disabled' }, 403)

    const body = await req.json() as Body
    const externalMessageId = clean(body.externalMessageId, 220)
    const source: VoiceReplySource = body.source === 'voice' ? 'voice' : 'text'
    if (!externalMessageId) return json({ success: false, error: 'external_message_id_required' }, 400)

    const settings = await resolveVoiceSettings(admin, client.organization_id)
    if (!shouldGenerateVoiceReply(settings, source)) return json({ success: true, generated: false, reason: 'reply_mode_text_only' })

    const inbound = await admin.from('messages').select('id,conversation_id').eq('organization_id', client.organization_id).eq('external_message_id', externalMessageId).eq('role', 'user').maybeSingle()
    if (inbound.error) throw inbound.error
    if (!inbound.data) return json({ success: true, generated: false, reason: 'inbound_message_not_found' })

    const assistant = await admin.from('messages').select('id,content,language').eq('organization_id', client.organization_id).eq('conversation_id', inbound.data.conversation_id).eq('role', 'assistant').contains('content_json', { requestMessageId: inbound.data.id }).maybeSingle()
    if (assistant.error) throw assistant.error
    if (!assistant.data?.content?.trim()) return json({ success: true, generated: false, reason: 'assistant_reply_not_found' })

    const existing = await admin.from('message_attachments').select('storage_path,mime_type,duration_ms,generation_voice').eq('organization_id', client.organization_id).eq('message_id', assistant.data.id).eq('audio_source', 'assistant_tts').maybeSingle()
    if (existing.error) throw existing.error
    if (existing.data?.storage_path) {
      const url = await signedAudio(admin, existing.data.storage_path)
      return json({ success: true, generated: true, idempotentReplay: true, audio: { url, mimeType: existing.data.mime_type ?? 'audio/wav', durationMs: Number(existing.data.duration_ms ?? 0), voiceName: existing.data.generation_voice ?? settings.voice_tts_voice, language: assistant.data.language === 'en' ? 'en' : 'ar' } })
    }

    await assertTtsQuota(admin, client.organization_id, settings)
    const language: 'ar' | 'en' = assistant.data.language === 'en' ? 'en' : 'ar'
    const speech = await generateSpeech(admin, settings, assistant.data.content, language)
    if (settings.included_monthly_tts_minutes != null) {
      const start = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString()
      const used = await admin.from('message_attachments').select('duration_ms').eq('organization_id', client.organization_id).eq('audio_source', 'assistant_tts').gte('created_at', start)
      if (used.error) throw used.error
      const usedMs = (used.data ?? []).reduce((sum, row) => sum + Number(row.duration_ms ?? 0), 0)
      if (usedMs + speech.durationMs > settings.included_monthly_tts_minutes * 60000) throw new Error('tts_monthly_limit_exceeded')
    }

    const now = new Date()
    storagePath = `${client.organization_id}/tts/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}.wav`
    const uploaded = await admin.storage.from('chat-media').upload(storagePath, speech.bytes, { contentType: speech.mimeType, upsert: false, cacheControl: '0' })
    if (uploaded.error) throw uploaded.error

    const attachment = await admin.from('message_attachments').insert({
      organization_id: client.organization_id,
      conversation_id: inbound.data.conversation_id,
      message_id: assistant.data.id,
      kind: 'audio',
      audio_source: 'assistant_tts',
      bucket: 'chat-media',
      storage_path: storagePath,
      original_audio_stored: true,
      mime_type: speech.mimeType,
      byte_size: speech.bytes.length,
      duration_ms: speech.durationMs,
      generation_provider: speech.provider,
      generation_model: speech.model,
      generation_voice: speech.voiceName,
      input_tokens: speech.inputTokens,
      output_tokens: speech.outputTokens,
      estimated_cost: speech.estimatedCost,
    })
    if (attachment.error) throw attachment.error

    const usage = await admin.from('usage_logs').insert({
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
    if (usage.error) throw usage.error

    const url = await signedAudio(admin, storagePath)
    storagePath = ''
    return json({ success: true, generated: true, audio: { url, mimeType: speech.mimeType, durationMs: speech.durationMs, voiceName: speech.voiceName, language } })
  } catch (error) {
    if (storagePath) await admin.storage.from('chat-media').remove([storagePath]).catch(() => undefined)
    const message = error instanceof Error ? error.message : 'tts_reply_failed'
    const status = ['tts_monthly_limit_exceeded', 'ai_cost_limit_exceeded'].includes(message) ? 429 : message.startsWith('tts_') ? 503 : 500
    return json({ success: false, error: message }, status)
  }
})
