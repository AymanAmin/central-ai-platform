import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.112.3'
import { getSupabaseSecretKey, json, preflight } from '../_shared/runtime.ts'
import { createAiProvider } from '../_shared/ai.ts'
import { createAzureOpenAiProvider } from '../_shared/azure-openai.ts'
import { createRuntimeProvider, globalProviderSettings } from '../_shared/agent-runtime.ts'
import { normalizeToolRequestSchema } from '../_shared/tool-schema.ts'

type AdminAction =
  | 'bootstrap_status' | 'bootstrap_super_admin' | 'create_organization' | 'create_api_client'
  | 'rotate_api_key' | 'set_api_client_active' | 'invite_user' | 'set_tool_secret'
  | 'create_agent_tool' | 'ai_provider_status' | 'set_ai_provider_secret' | 'test_ai_provider'
  | 'test_agent_runtime'
type AppRole = 'SUPER_ADMIN' | 'ORGANIZATION_ADMIN' | 'KNOWLEDGE_MANAGER' | 'SUPPORT_AGENT' | 'VIEWER'
type AgentTestConfig = {
  chatProvider?: string
  chatModel?: string
  embeddingProvider?: string
  embeddingModel?: string
  fallbackProvider?: string | null
  fallbackModel?: string | null
}
interface AdminBody {
  action?: AdminAction
  organizationId?: string | null
  apiClientId?: string
  nameAr?: string
  nameEn?: string
  defaultLanguage?: 'ar' | 'en'
  providerSettingId?: string
  providerSecret?: string
  name?: string
  code?: string
  rateLimitPerMinute?: number
  capabilities?: string[]
  allowedIps?: string[]
  isActive?: boolean
  email?: string
  fullName?: string
  userRole?: AppRole
  toolId?: string
  toolSecret?: Record<string, unknown>
  agent?: AgentTestConfig
  tool?: {
    name?: string
    code?: string
    method?: 'GET' | 'POST'
    endpointUrl?: string
    authType?: string
    requestSchema?: Record<string, unknown>
    responseSchema?: Record<string, unknown>
    isReadOnly?: boolean
    requiresVerification?: boolean
    requiresHumanApproval?: boolean
    timeoutSeconds?: number
  }
}

const normalizeCode = (value: string) => value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_')
const generateApiKey = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const raw = btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
  return `ai_live_${raw}`
}
const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
const inviteRedirectUrl = () => Deno.env.get('APP_URL')?.trim() || 'https://aymanamin.github.io/central-ai-platform/'
const allowedProviders = new Set(['gemini', 'openrouter', 'openai', 'azure_openai'])
const allowedEmbeddingProviders = new Set(['gemini', 'openrouter', 'openai'])
const cleanModel = (value: string | undefined) => value?.trim().slice(0, 180) ?? ''
const validateProvider = (value: string | undefined) => !!value && allowedProviders.has(value)
const validateEmbeddingProvider = (value: string | undefined) => !!value && allowedEmbeddingProviders.has(value)

Deno.serve(async (req: Request) => {
  const cors = preflight(req)
  if (cors) return cors
  if (req.method !== 'POST') return json({ success: false, error: 'method_not_allowed' }, 405)

  try {
    const authHeader = req.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) return json({ success: false, error: 'unauthorized' }, 401)
    const token = authHeader.slice(7)
    const url = Deno.env.get('SUPABASE_URL')
    if (!url) throw new Error('SUPABASE_URL missing')
    const admin = createClient(url, getSupabaseSecretKey(), { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: authData, error: authError } = await admin.auth.getUser(token)
    if (authError || !authData.user) return json({ success: false, error: 'unauthorized' }, 401)

    const body = await req.json() as AdminBody
    if (!body.action) return json({ success: false, error: 'missing_action' }, 400)

    const { count: profileCount, error: countError } = await admin.from('profiles').select('id', { count: 'exact', head: true })
    if (countError) throw countError
    if (body.action === 'bootstrap_status') return json({ success: true, canBootstrap: (profileCount ?? 0) === 0 })

    if (body.action === 'bootstrap_super_admin') {
      if ((profileCount ?? 0) !== 0) return json({ success: false, error: 'bootstrap_closed' }, 409)
      if (!body.fullName?.trim()) return json({ success: false, error: 'full_name_required' }, 400)
      const email = (authData.user.email ?? '').toLowerCase()
      if (!email) return json({ success: false, error: 'email_required' }, 400)
      const { error } = await admin.from('profiles').insert({ id: authData.user.id, organization_id: null, full_name: body.fullName.trim(), email, role: 'SUPER_ADMIN', is_active: true })
      if (error) return json({ success: false, error: 'bootstrap_failed', detail: error.message }, 400)
      await admin.from('audit_logs').insert({ organization_id: null, user_id: authData.user.id, action: 'Bootstrap Super Admin', entity_type: 'profile', entity_id: authData.user.id, metadata: { email } })
      return json({ success: true, role: 'SUPER_ADMIN' })
    }

    const { data: profile, error: profileError } = await admin.from('profiles').select('id,organization_id,role,is_active').eq('id', authData.user.id).single()
    if (profileError || !profile?.is_active) return json({ success: false, error: 'forbidden' }, 403)
    const role = profile.role as AppRole
    if (!['SUPER_ADMIN', 'ORGANIZATION_ADMIN'].includes(role)) return json({ success: false, error: 'forbidden' }, 403)
    const assertOrg = (organizationId: string | null | undefined) => {
      if (!organizationId) throw new Error('organization_required')
      if (role !== 'SUPER_ADMIN' && organizationId !== profile.organization_id) throw new Error('organization_forbidden')
    }

    if (body.action === 'create_organization') {
      if (role !== 'SUPER_ADMIN') return json({ success: false, error: 'forbidden' }, 403)
      if (!body.nameAr?.trim() || !body.nameEn?.trim() || !body.code?.trim()) return json({ success: false, error: 'organization_fields_required' }, 400)
      const normalized = normalizeCode(body.code)
      const created = await admin.rpc('create_organization_with_settings', { p_code: normalized, p_name_ar: body.nameAr.trim(), p_name_en: body.nameEn.trim(), p_default_language: body.defaultLanguage ?? 'ar' })
      if (created.error) return json({ success: false, error: 'organization_create_failed', detail: created.error.message }, 400)
      await admin.from('audit_logs').insert({ organization_id: created.data, user_id: profile.id, action: 'Create Organization', entity_type: 'organization', entity_id: created.data, metadata: { code: normalized } })
      return json({ success: true, organizationId: created.data }, 201)
    }

    if (body.action === 'ai_provider_status') {
      if (role !== 'SUPER_ADMIN') return json({ success: false, error: 'forbidden' }, 403)
      const setting = await admin.from('ai_provider_settings').select('id,provider,chat_model,embedding_model,is_active,is_default').is('organization_id', null).eq('is_active', true).eq('is_default', true).maybeSingle()
      if (setting.error) throw setting.error
      if (!setting.data) return json({ success: false, error: 'ai_provider_not_configured' }, 404)
      const configured = await admin.rpc('has_ai_provider_secret', { p_provider_setting_id: setting.data.id })
      if (configured.error) throw configured.error
      return json({ success: true, providerSettingId: setting.data.id, provider: setting.data.provider, chatModel: setting.data.chat_model, embeddingModel: setting.data.embedding_model, configured: Boolean(configured.data) })
    }

    if (body.action === 'set_ai_provider_secret') {
      if (role !== 'SUPER_ADMIN') return json({ success: false, error: 'forbidden' }, 403)
      if (!body.providerSettingId || !body.providerSecret?.trim()) return json({ success: false, error: 'provider_setting_and_secret_required' }, 400)
      if (body.providerSecret.trim().length < 20 || body.providerSecret.length > 512) return json({ success: false, error: 'invalid_provider_secret' }, 400)
      const setting = await admin.from('ai_provider_settings').select('id,provider').eq('id', body.providerSettingId).is('organization_id', null).single()
      if (setting.error || !setting.data) return json({ success: false, error: 'provider_setting_not_found' }, 404)
      const stored = await admin.rpc('set_ai_provider_secret', { p_provider_setting_id: setting.data.id, p_secret: body.providerSecret.trim() })
      if (stored.error) return json({ success: false, error: 'provider_secret_store_failed', detail: stored.error.message }, 500)
      await admin.from('audit_logs').insert({ organization_id: null, user_id: profile.id, action: 'Set AI Provider Secret', entity_type: 'ai_provider_setting', entity_id: setting.data.id, metadata: { provider: setting.data.provider } })
      return json({ success: true, configured: true })
    }

    if (body.action === 'test_ai_provider') {
      if (role !== 'SUPER_ADMIN') return json({ success: false, error: 'forbidden' }, 403)
      if (!body.providerSettingId) return json({ success: false, error: 'provider_setting_required' }, 400)
      const setting = await admin.from('ai_provider_settings').select('id,provider,chat_model,embedding_model').eq('id', body.providerSettingId).is('organization_id', null).single()
      if (setting.error || !setting.data) return json({ success: false, error: 'provider_setting_not_found' }, 404)
      const secret = await admin.rpc('get_ai_provider_secret', { p_provider_setting_id: setting.data.id })
      if (secret.error) throw secret.error
      if (typeof secret.data !== 'string' || !secret.data.trim()) return json({ success: false, error: 'provider_secret_missing' }, 409)
      const ai = setting.data.provider === 'azure_openai'
        ? createAzureOpenAiProvider(setting.data, secret.data)
        : createAiProvider(setting.data, secret.data)
      const started = performance.now()
      const test = await ai.chat({ instructions: 'You are a provider compatibility test. Return answer exactly OK, intent connection_test, requestHuman false, and no actions.', userInput: 'Connection test', maxOutputTokens: 128 })
      if (test.answer.trim().toUpperCase() !== 'OK' || test.requestHuman || test.actions.length) throw new Error('provider_structured_test_failed')
      return json({ success: true, provider: setting.data.provider, model: setting.data.chat_model, latencyMs: Math.round(performance.now() - started), inputTokens: test.inputTokens, outputTokens: test.outputTokens })
    }

    if (body.action === 'test_agent_runtime') {
      if (role !== 'SUPER_ADMIN') return json({ success: false, error: 'forbidden' }, 403)
      assertOrg(body.organizationId)
      const config = body.agent
      const chatProvider = config?.chatProvider
      const chatModel = cleanModel(config?.chatModel)
      const embeddingProvider = config?.embeddingProvider
      const embeddingModel = cleanModel(config?.embeddingModel)
      const fallbackProvider = config?.fallbackProvider || null
      const fallbackModel = cleanModel(config?.fallbackModel ?? undefined) || null
      if (!validateProvider(chatProvider) || !chatModel || !validateEmbeddingProvider(embeddingProvider) || !embeddingModel) return json({ success: false, error: 'agent_runtime_fields_required' }, 400)
      if ((fallbackProvider && !validateProvider(fallbackProvider)) || (fallbackProvider && !fallbackModel) || (!fallbackProvider && fallbackModel)) return json({ success: false, error: 'invalid_fallback_configuration' }, 400)

      const started = performance.now()
      const { ai: chatAi } = await createRuntimeProvider(admin, chatProvider!, chatModel, embeddingModel)
      const chatStarted = performance.now()
      const chatTest = await chatAi.chat({ instructions: 'You are a provider compatibility test. Return answer exactly OK, intent connection_test, requestHuman false, and no actions.', userInput: 'Connection test', maxOutputTokens: 128 })
      if (chatTest.answer.trim().toUpperCase() !== 'OK' || chatTest.requestHuman || chatTest.actions.length) throw new Error('agent_chat_structured_test_failed')
      const chatLatencyMs = Math.round(performance.now() - chatStarted)

      const embeddingGlobal = await globalProviderSettings(admin, embeddingProvider!)
      if (!embeddingGlobal) throw new Error(`ai_provider_not_configured:${embeddingProvider}`)
      const embeddingAi = createAiProvider({ ...embeddingGlobal, provider: embeddingProvider!, embedding_model: embeddingModel })
      const embeddingStarted = performance.now()
      const embeddingTest = await embeddingAi.embedding(['central ai provider compatibility'], 'RETRIEVAL_QUERY')
      if (embeddingTest.vectors.length !== 1 || embeddingTest.vectors[0]?.length !== 1536) throw new Error('agent_embedding_dimension_test_failed')
      const embeddingLatencyMs = Math.round(performance.now() - embeddingStarted)

      let fallbackLatencyMs: number | null = null
      if (fallbackProvider && fallbackModel) {
        const { ai: fallbackAi } = await createRuntimeProvider(admin, fallbackProvider, fallbackModel, embeddingModel)
        const fallbackStarted = performance.now()
        const fallbackTest = await fallbackAi.chat({ instructions: 'You are a provider compatibility test. Return answer exactly OK, intent connection_test, requestHuman false, and no actions.', userInput: 'Connection test', maxOutputTokens: 128 })
        if (fallbackTest.answer.trim().toUpperCase() !== 'OK' || fallbackTest.requestHuman || fallbackTest.actions.length) throw new Error('agent_fallback_structured_test_failed')
        fallbackLatencyMs = Math.round(performance.now() - fallbackStarted)
      }

      return json({ success: true, chatProvider, chatModel, chatLatencyMs, embeddingProvider, embeddingModel, embeddingLatencyMs, fallbackProvider, fallbackModel, fallbackLatencyMs, latencyMs: Math.round(performance.now() - started) })
    }

    if (body.action === 'invite_user') {
      if (!body.email?.trim() || !body.fullName?.trim() || !body.userRole) return json({ success: false, error: 'email_full_name_role_required' }, 400)
      const targetRole = body.userRole
      const targetOrg = targetRole === 'SUPER_ADMIN' ? null : body.organizationId
      if (targetRole === 'SUPER_ADMIN' && role !== 'SUPER_ADMIN') return json({ success: false, error: 'forbidden' }, 403)
      if (targetRole !== 'SUPER_ADMIN') assertOrg(targetOrg)
      const email = body.email.trim().toLowerCase()
      const { data: inv, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: inviteRedirectUrl() })
      if (inviteError || !inv.user) return json({ success: false, error: 'user_invite_failed', detail: inviteError?.message ?? 'No user returned' }, 400)
      const { error: insertError } = await admin.from('profiles').insert({ id: inv.user.id, organization_id: targetOrg, full_name: body.fullName.trim(), email, role: targetRole, is_active: true })
      if (insertError) {
        await admin.auth.admin.deleteUser(inv.user.id)
        return json({ success: false, error: 'profile_create_failed', detail: insertError.message }, 400)
      }
      await admin.from('audit_logs').insert({ organization_id: targetOrg, user_id: profile.id, action: 'Invite User', entity_type: 'profile', entity_id: inv.user.id, metadata: { email, role: targetRole, redirectTo: inviteRedirectUrl() } })
      return json({ success: true, userId: inv.user.id, email, role: targetRole }, 201)
    }

    if (body.action === 'create_agent_tool') {
      assertOrg(body.organizationId)
      const t = body.tool
      if (!t?.name?.trim() || !t.code?.trim() || !t.method || !t.endpointUrl?.trim()) return json({ success: false, error: 'tool_fields_required' }, 400)
      if (t.isReadOnly === false) return json({ success: false, error: 'mvp_read_only_required' }, 400)
      let parsed: URL
      try { parsed = new URL(t.endpointUrl) } catch { return json({ success: false, error: 'invalid_tool_url' }, 400) }
      if (!['http:', 'https:'].includes(parsed.protocol)) return json({ success: false, error: 'invalid_tool_protocol' }, 400)
      let requestSchema
      try { requestSchema = normalizeToolRequestSchema(t.requestSchema ?? {}) } catch (error) { return json({ success: false, error: error instanceof Error ? error.message : 'invalid_tool_request_schema' }, 400) }
      const { data: tool, error } = await admin.from('agent_tools').insert({
        organization_id: body.organizationId,
        name: t.name.trim(), code: normalizeCode(t.code), method: t.method, endpoint_url: parsed.toString(), auth_type: t.authType ?? 'none',
        request_schema: requestSchema, response_schema: t.responseSchema ?? {}, is_read_only: true,
        requires_verification: t.requiresVerification ?? false, requires_human_approval: t.requiresHumanApproval ?? false,
        timeout_seconds: Math.min(30, Math.max(1, t.timeoutSeconds ?? 10)), is_active: true,
      }).select('id,organization_id,name,code,method,endpoint_url,auth_type,request_schema,is_read_only,requires_verification,requires_human_approval,timeout_seconds,is_active,created_at').single()
      if (error) return json({ success: false, error: 'tool_create_failed', detail: error.message }, 400)
      if ((t.authType ?? 'none') !== 'none' && body.toolSecret) {
        const stored = await admin.rpc('set_agent_tool_secret', { p_tool_id: tool.id, p_secret: body.toolSecret })
        if (stored.error) {
          await admin.from('agent_tools').delete().eq('id', tool.id)
          return json({ success: false, error: 'tool_secret_store_failed', detail: stored.error.message }, 500)
        }
      }
      await admin.from('audit_logs').insert({ organization_id: body.organizationId, user_id: profile.id, action: 'Create Tool', entity_type: 'agent_tool', entity_id: tool.id, metadata: { code: tool.code, method: tool.method, parameterCount: requestSchema.parameters.length } })
      return json({ success: true, tool }, 201)
    }

    if (body.action === 'set_tool_secret') {
      if (!body.toolId || !body.toolSecret) return json({ success: false, error: 'tool_id_and_secret_required' }, 400)
      const tool = await admin.from('agent_tools').select('id,organization_id').eq('id', body.toolId).single()
      if (tool.error || !tool.data) return json({ success: false, error: 'tool_not_found' }, 404)
      assertOrg(tool.data.organization_id)
      const stored = await admin.rpc('set_agent_tool_secret', { p_tool_id: body.toolId, p_secret: body.toolSecret })
      if (stored.error) return json({ success: false, error: 'tool_secret_store_failed', detail: stored.error.message }, 500)
      await admin.from('audit_logs').insert({ organization_id: tool.data.organization_id, user_id: profile.id, action: 'Set Tool Secret', entity_type: 'agent_tool', entity_id: tool.data.id })
      return json({ success: true, toolId: tool.data.id })
    }

    if (body.action === 'create_api_client') {
      assertOrg(body.organizationId)
      if (!body.name?.trim() || !body.code?.trim()) return json({ success: false, error: 'name_and_code_required' }, 400)
      const apiKey = generateApiKey()
      const hash = await sha256(apiKey)
      const prefix = apiKey.slice(0, 16)
      const { data: client, error } = await admin.from('api_clients').insert({ organization_id: body.organizationId, name: body.name.trim(), code: normalizeCode(body.code), api_key_hash: hash, api_key_prefix: prefix, rate_limit_per_minute: body.rateLimitPerMinute ?? 60, capabilities: body.capabilities?.length ? body.capabilities : ['chat'], allowed_ips: body.allowedIps ?? [] }).select('id,organization_id,name,code,api_key_prefix,is_active,rate_limit_per_minute,capabilities,allowed_ips,created_at').single()
      if (error) return json({ success: false, error: 'api_client_create_failed', detail: error.message }, 400)
      await admin.from('audit_logs').insert({ organization_id: body.organizationId, user_id: profile.id, action: 'Create API Client', entity_type: 'api_client', entity_id: client.id, metadata: { code: client.code } })
      return json({ success: true, client, apiKey, warning: 'Copy this key now. It will not be shown again.' }, 201)
    }

    if (!body.apiClientId) return json({ success: false, error: 'api_client_id_required' }, 400)
    const { data: existing, error: existingError } = await admin.from('api_clients').select('id,organization_id,code').eq('id', body.apiClientId).single()
    if (existingError || !existing) return json({ success: false, error: 'api_client_not_found' }, 404)
    assertOrg(existing.organization_id)

    if (body.action === 'rotate_api_key') {
      const apiKey = generateApiKey()
      const hash = await sha256(apiKey)
      const prefix = apiKey.slice(0, 16)
      const { error } = await admin.from('api_clients').update({ api_key_hash: hash, api_key_prefix: prefix }).eq('id', existing.id)
      if (error) return json({ success: false, error: 'api_key_rotation_failed' }, 500)
      await admin.from('audit_logs').insert({ organization_id: existing.organization_id, user_id: profile.id, action: 'Rotate Key', entity_type: 'api_client', entity_id: existing.id })
      return json({ success: true, apiClientId: existing.id, apiKey, apiKeyPrefix: prefix, warning: 'Copy this key now. It will not be shown again.' })
    }

    if (body.action === 'set_api_client_active') {
      if (typeof body.isActive !== 'boolean') return json({ success: false, error: 'is_active_required' }, 400)
      const { error } = await admin.from('api_clients').update({ is_active: body.isActive }).eq('id', existing.id)
      if (error) return json({ success: false, error: 'api_client_update_failed' }, 500)
      await admin.from('audit_logs').insert({ organization_id: existing.organization_id, user_id: profile.id, action: body.isActive ? 'Enable API Client' : 'Disable API Client', entity_type: 'api_client', entity_id: existing.id })
      return json({ success: true, apiClientId: existing.id, isActive: body.isActive })
    }

    return json({ success: false, error: 'unsupported_action' }, 400)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error'
    return json({ success: false, error: message }, message === 'organization_forbidden' ? 403 : message === 'organization_required' ? 400 : 500)
  }
})
