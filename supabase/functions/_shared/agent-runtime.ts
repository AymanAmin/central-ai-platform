import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.112.3'
import { createAiProvider, type AiProvider, type AiProviderSettings } from './ai.ts'

export interface OrganizationAgentRuntime {
  organization_id: string
  agent_name: string
  chat_provider: string
  chat_model: string
  embedding_provider: string
  embedding_model: string
  fallback_provider: string | null
  fallback_model: string | null
  included_monthly_messages: number | null
  included_monthly_tokens: number | null
  monthly_ai_cost_limit_usd: number | null
  is_active: boolean
}

export interface RuntimeProvider extends AiProviderSettings {
  max_output_tokens: number | null
}

const defaultRuntime = (organizationId: string, provider: RuntimeProvider): OrganizationAgentRuntime => ({
  organization_id: organizationId,
  agent_name: 'AI Agent',
  chat_provider: provider.provider,
  chat_model: provider.chat_model,
  embedding_provider: provider.embedding_model.replace(/^models\//, '').startsWith('gemini-') ? 'gemini' : provider.provider,
  embedding_model: provider.embedding_model,
  fallback_provider: provider.provider === 'gemini' ? null : 'gemini',
  fallback_model: provider.provider === 'gemini' ? null : 'gemini-3.1-flash-lite',
  included_monthly_messages: null,
  included_monthly_tokens: null,
  monthly_ai_cost_limit_usd: null,
  is_active: true,
})

export async function globalProviderSettings(admin: SupabaseClient, provider?: string): Promise<RuntimeProvider | null> {
  let query = admin
    .from('ai_provider_settings')
    .select('id,provider,chat_model,embedding_model,max_output_tokens,is_default')
    .is('organization_id', null)
    .eq('is_active', true)
  if (provider) query = query.eq('provider', provider)
  const result = await query.order('is_default', { ascending: false }).order('updated_at', { ascending: false }).limit(1).maybeSingle()
  if (result.error) throw result.error
  if (!result.data) return null
  return {
    id: result.data.id,
    provider: result.data.provider,
    chat_model: result.data.chat_model,
    embedding_model: result.data.embedding_model,
    max_output_tokens: result.data.max_output_tokens,
  }
}

export async function resolveOrganizationAgent(admin: SupabaseClient, organizationId: string): Promise<OrganizationAgentRuntime> {
  const configured = await admin
    .from('organization_agents')
    .select('organization_id,agent_name,chat_provider,chat_model,embedding_provider,embedding_model,fallback_provider,fallback_model,included_monthly_messages,included_monthly_tokens,monthly_ai_cost_limit_usd,is_active')
    .eq('organization_id', organizationId)
    .maybeSingle()
  if (configured.error) throw configured.error
  if (configured.data?.is_active) return {
    ...configured.data,
    included_monthly_messages: configured.data.included_monthly_messages == null ? null : Number(configured.data.included_monthly_messages),
    included_monthly_tokens: configured.data.included_monthly_tokens == null ? null : Number(configured.data.included_monthly_tokens),
    monthly_ai_cost_limit_usd: configured.data.monthly_ai_cost_limit_usd == null ? null : Number(configured.data.monthly_ai_cost_limit_usd),
  } as OrganizationAgentRuntime

  const global = await globalProviderSettings(admin)
  if (!global) throw new Error('ai_provider_not_configured')
  return defaultRuntime(organizationId, global)
}

export async function runtimeProvider(
  admin: SupabaseClient,
  provider: string,
  chatModel: string,
  embeddingModel: string,
): Promise<RuntimeProvider> {
  const global = await globalProviderSettings(admin, provider)
  if (!global) throw new Error(`ai_provider_not_configured:${provider}`)
  return { ...global, provider, chat_model: chatModel, embedding_model: embeddingModel }
}

export async function createRuntimeProvider(
  admin: SupabaseClient,
  provider: string,
  chatModel: string,
  embeddingModel: string,
): Promise<{ settings: RuntimeProvider; ai: AiProvider }> {
  const settings = await runtimeProvider(admin, provider, chatModel, embeddingModel)
  return { settings, ai: createAiProvider(settings) }
}
