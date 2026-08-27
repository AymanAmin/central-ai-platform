import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createAdminClient, json } from '../_shared/runtime.ts'
import { resolveVoiceSettings } from '../_shared/voice.ts'
import { assertTtsQuota, generateSpeech } from '../_shared/tts.ts'

interface Body {
  organizationId?: string
  text?: string
  language?: 'ar' | 'en'
  fileName?: string
}

const cleanFileName = (value: string | undefined) => {
  const base = (value ?? 'tts-export.wav').trim().replace(/[^A-Za-z0-9._-]/g, '-').replace(/-+/g, '-').slice(0, 100)
  return base.toLowerCase().endsWith('.wav') ? base : `${base || 'tts-export'}.wav`
}

async function authenticate(req: Request, admin: ReturnType<typeof createAdminClient>) {
  const supplied = req.headers.get('x-worker-token')
  if (supplied) {
    const secret = await admin.rpc('get_background_worker_token')
    if (!secret.error && secret.data === supplied) return true
  }

  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return false
  const user = await admin.auth.getUser(auth.slice(7))
  if (user.error || !user.data.user) return false
  const profile = await admin.from('profiles').select('role,is_active').eq('id', user.data.user.id).single()
  return !profile.error && Boolean(profile.data?.is_active) && profile.data?.role === 'SUPER_ADMIN'
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ success: false, error: 'method_not_allowed' }, 405)

  const admin = createAdminClient()
  if (!await authenticate(req, admin)) return json({ success: false, error: 'unauthorized' }, 401)

  let storagePath = ''
  try {
    const body = await req.json() as Body
    const organizationId = body.organizationId?.trim() ?? ''
    const text = body.text?.trim() ?? ''
    const language: 'ar' | 'en' = body.language === 'en' ? 'en' : 'ar'
    if (!organizationId) return json({ success: false, error: 'organization_id_required' }, 400)
    if (!text) return json({ success: false, error: 'text_required' }, 400)
    if (text.length > 8000) return json({ success: false, error: 'text_too_long' }, 400)

    const organization = await admin.from('organizations').select('id,is_active').eq('id', organizationId).maybeSingle()
    if (organization.error) throw organization.error
    if (!organization.data?.is_active) return json({ success: false, error: 'organization_not_found_or_disabled' }, 404)

    const settings = await resolveVoiceSettings(admin, organizationId)
    if (!settings.voice_enabled) return json({ success: false, error: 'voice_disabled' }, 409)
    if (settings.voice_tts_provider !== 'gemini') return json({ success: false, error: 'gemini_tts_not_configured' }, 409)

    await assertTtsQuota(admin, organizationId, settings)
    const speech = await generateSpeech(admin, settings, text, language)

    if (settings.included_monthly_tts_minutes != null) {
      const start = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString()
      const used = await admin.from('message_attachments').select('duration_ms').eq('organization_id', organizationId).eq('audio_source', 'assistant_tts').gte('created_at', start)
      if (used.error) throw used.error
      const usedMs = (used.data ?? []).reduce((sum, row) => sum + Number(row.duration_ms ?? 0), 0)
      if (usedMs + speech.durationMs > settings.included_monthly_tts_minutes * 60000) throw new Error('tts_monthly_limit_exceeded')
    }

    const exportId = crypto.randomUUID()
    storagePath = `${organizationId}/exports/${exportId}-${cleanFileName(body.fileName)}`
    const uploaded = await admin.storage.from('chat-media').upload(storagePath, speech.bytes, {
      contentType: speech.mimeType,
      upsert: false,
      cacheControl: '0',
    })
    if (uploaded.error) throw uploaded.error

    const usage = await admin.from('usage_logs').insert({
      organization_id: organizationId,
      operation: 'voice_tts_export',
      provider: speech.provider,
      model: speech.model,
      input_tokens: speech.inputTokens,
      output_tokens: speech.outputTokens,
      estimated_cost: speech.estimatedCost,
      latency_ms: speech.latencyMs,
    })
    if (usage.error) throw usage.error

    const signed = await admin.storage.from('chat-media').createSignedUrl(storagePath, 3600)
    if (signed.error || !signed.data?.signedUrl) throw signed.error ?? new Error('tts_signed_url_failed')

    return json({
      success: true,
      audio: {
        url: signed.data.signedUrl,
        storagePath,
        mimeType: speech.mimeType,
        durationMs: speech.durationMs,
        provider: speech.provider,
        model: speech.model,
        voiceName: speech.voiceName,
        language,
      },
      usage: {
        inputTokens: speech.inputTokens,
        outputTokens: speech.outputTokens,
        estimatedCost: speech.estimatedCost,
        latencyMs: speech.latencyMs,
      },
    })
  } catch (error) {
    if (storagePath) await admin.storage.from('chat-media').remove([storagePath]).catch(() => undefined)
    const message = error instanceof Error ? error.message : 'tts_export_failed'
    const status = ['tts_monthly_limit_exceeded', 'ai_cost_limit_exceeded'].includes(message) ? 429 : message.startsWith('tts_') ? 503 : 500
    return json({ success: false, error: message }, status)
  }
})
