import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.112.3'
import {
  createAiProvider,
  type AiChatResult,
  type AiProvider,
  type AiProviderSettings,
  type AiToolPlanResult,
  type EmbeddingResult,
  type EmbeddingTask,
} from './ai-router.ts'
import { isFailoverEligibleProviderError } from './provider-error.ts'

export interface AgentChatRoute { provider: string; model: string }

export interface OrganizationAgentRuntime {
  organization_id: string
  agent_name: string
  chat_provider: string
  chat_model: string
  chat_routes: AgentChatRoute[]
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

const AUTO_PROVIDER = '__auto_selected_routes__'
const ALLOWED_CHAT_PROVIDERS = new Set(['gemini', 'openrouter', 'openai', 'groq', 'cloudflare'])

const cleanRoute = (value: unknown): AgentChatRoute | null => {
  if (!value || typeof value !== 'object') return null
  const provider = String((value as Record<string, unknown>).provider ?? '').trim()
  const model = String((value as Record<string, unknown>).model ?? '').trim()
  if (!ALLOWED_CHAT_PROVIDERS.has(provider) || !model || model.length > 180) return null
  return { provider, model }
}

export const normalizeChatRoutes = (
  value: unknown,
  legacy?: { provider: string; model: string; fallbackProvider?: string | null; fallbackModel?: string | null },
): AgentChatRoute[] => {
  const source = Array.isArray(value) ? value.map(cleanRoute).filter((item): item is AgentChatRoute => Boolean(item)) : []
  if (!source.length && legacy?.provider && legacy.model) {
    source.push({ provider: legacy.provider, model: legacy.model })
    if (legacy.fallbackProvider && legacy.fallbackModel) source.push({ provider: legacy.fallbackProvider, model: legacy.fallbackModel })
  }
  const seen = new Set<string>()
  return source.filter(route => {
    const key = `${route.provider}\u0000${route.model}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 8)
}

const defaultRuntime = (organizationId: string, provider: RuntimeProvider): OrganizationAgentRuntime => ({
  organization_id: organizationId,
  agent_name: 'AI Agent',
  chat_provider: provider.provider,
  chat_model: provider.chat_model,
  chat_routes: [{ provider: provider.provider, model: provider.chat_model }],
  embedding_provider: provider.embedding_model.replace(/^models\//, '').startsWith('gemini-') ? 'gemini' : provider.provider,
  embedding_model: provider.embedding_model,
  fallback_provider: null,
  fallback_model: null,
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

export async function rankOrganizationChatRoutes(admin: SupabaseClient, agent: OrganizationAgentRuntime): Promise<AgentChatRoute[]> {
  const routes = normalizeChatRoutes(agent.chat_routes, {
    provider: agent.chat_provider,
    model: agent.chat_model,
    fallbackProvider: agent.fallback_provider,
    fallbackModel: agent.fallback_model,
  })
  if (routes.length <= 1) return routes.slice(0, 1)

  const today = new Date().toISOString().slice(0, 10)
  const now = new Date().toISOString()
  const [pricingResult, cooldownResult] = await Promise.all([
    admin
      .from('model_pricing')
      .select('provider,model,input_cost_per_million,output_cost_per_million,effective_from')
      .eq('is_active', true)
      .lte('effective_from', today)
      .order('effective_from', { ascending: false }),
    admin
      .from('ai_provider_global_cooldowns')
      .select('provider,model,blocked_until')
      .gt('blocked_until', now),
  ])
  if (pricingResult.error) throw pricingResult.error
  if (cooldownResult.error) throw cooldownResult.error

  const prices = new Map<string, number>()
  for (const row of pricingResult.data ?? []) {
    const key = `${row.provider}\u0000${row.model}`
    if (prices.has(key)) continue
    prices.set(key, Number(row.input_cost_per_million) * 4 + Number(row.output_cost_per_million))
  }

  const blocked = new Set((cooldownResult.data ?? []).map(row => `${row.provider}\u0000${row.model}`))
  const available = routes.filter(route => !blocked.has(`${route.provider}\u0000${route.model}`))
  const candidates = available.length ? available : routes
  const originalOrder = new Map(routes.map((route, index) => [`${route.provider}\u0000${route.model}`, index]))

  return [...candidates].sort((a, b) => {
    const aKey = `${a.provider}\u0000${a.model}`
    const bKey = `${b.provider}\u0000${b.model}`
    const aScore = prices.get(aKey) ?? Number.POSITIVE_INFINITY
    const bScore = prices.get(bKey) ?? Number.POSITIVE_INFINITY
    if (aScore !== bScore) return aScore - bScore
    return (originalOrder.get(aKey) ?? 0) - (originalOrder.get(bKey) ?? 0)
  })
}

export async function resolveOrganizationAgent(admin: SupabaseClient, organizationId: string): Promise<OrganizationAgentRuntime> {
  const configured = await admin
    .from('organization_agents')
    .select('organization_id,agent_name,chat_provider,chat_model,chat_routes,embedding_provider,embedding_model,fallback_provider,fallback_model,included_monthly_messages,included_monthly_tokens,monthly_ai_cost_limit_usd,is_active')
    .eq('organization_id', organizationId)
    .maybeSingle()
  if (configured.error) throw configured.error

  let runtime: OrganizationAgentRuntime
  if (configured.data?.is_active) {
    const routes = normalizeChatRoutes(configured.data.chat_routes, {
      provider: configured.data.chat_provider,
      model: configured.data.chat_model,
      fallbackProvider: configured.data.fallback_provider,
      fallbackModel: configured.data.fallback_model,
    })
    if (!routes.length) throw new Error('organization_agent_routes_missing')
    runtime = {
      ...configured.data,
      chat_routes: routes,
      included_monthly_messages: configured.data.included_monthly_messages == null ? null : Number(configured.data.included_monthly_messages),
      included_monthly_tokens: configured.data.included_monthly_tokens == null ? null : Number(configured.data.included_monthly_tokens),
      monthly_ai_cost_limit_usd: configured.data.monthly_ai_cost_limit_usd == null ? null : Number(configured.data.monthly_ai_cost_limit_usd),
    } as OrganizationAgentRuntime
  } else {
    const global = await globalProviderSettings(admin)
    if (!global) throw new Error('ai_provider_not_configured')
    runtime = defaultRuntime(organizationId, global)
  }

  const ranked = await rankOrganizationChatRoutes(admin, runtime)
  if (!ranked.length) throw new Error('organization_agent_routes_missing')

  return {
    ...runtime,
    chat_routes: ranked,
    chat_provider: ranked[0]!.provider,
    chat_model: ranked[0]!.model,
    fallback_provider: ranked.length > 1 ? AUTO_PROVIDER : null,
    fallback_model: ranked.length > 1 ? JSON.stringify(ranked.slice(1)) : null,
  }
}

export async function runtimeProvider(admin: SupabaseClient, provider: string, chatModel: string, embeddingModel: string): Promise<RuntimeProvider> {
  const global = await globalProviderSettings(admin, provider)
  if (!global) throw new Error(`ai_provider_not_configured:${provider}`)
  return { ...global, provider, chat_model: chatModel, embedding_model: embeddingModel }
}

const shouldTryNextSelectedRoute = (error: unknown) => {
  if (isFailoverEligibleProviderError(error)) return true
  const message = error instanceof Error ? error.message : ''
  return error instanceof SyntaxError || /(?:output_missing|structured|invalid_json|json_parse|api_key_missing|credentials_missing|credentials_invalid|secret_lookup_failed)/i.test(message)
}

class SelectedRoutesProvider implements AiProvider {
  private active: AgentChatRoute

  constructor(
    private admin: SupabaseClient,
    private routes: AgentChatRoute[],
    readonly embeddingModel: string,
  ) {
    this.active = routes[0]!
  }

  get provider() { return this.active.provider }
  get chatModel() { return this.active.model }

  private async run<T>(invoke: (provider: AiProvider) => Promise<T>): Promise<T> {
    let lastError: unknown = new Error('ai_provider_unavailable')
    for (const route of this.routes) {
      this.active = route
      try {
        const settings = await runtimeProvider(this.admin, route.provider, route.model, this.embeddingModel)
        return await invoke(createAiProvider(settings))
      } catch (error) {
        lastError = error
        if (!shouldTryNextSelectedRoute(error)) throw error
        console.warn('selected_chat_route_failed_trying_next', {
          provider: route.provider,
          model: route.model,
          error: error instanceof Error ? error.message : 'unknown',
        })
      }
    }
    throw lastError
  }

  embedding(_texts: string[], _task?: EmbeddingTask): Promise<EmbeddingResult> {
    return Promise.reject(new Error('embedding_provider_not_supported:auto_routes'))
  }

  chat(input: { instructions: string; userInput: string; maxOutputTokens: number }): Promise<AiChatResult> {
    return this.run(provider => provider.chat(input))
  }

  chatWithTools(input: { instructions: string; userInput: string; maxOutputTokens: number }): Promise<AiToolPlanResult> {
    return this.run(provider => provider.chatWithTools(input))
  }

  text(instructions: string, input: string, maxOutputTokens?: number): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
    return this.run(provider => provider.text(instructions, input, maxOutputTokens))
  }
}

export async function createRuntimeProvider(
  admin: SupabaseClient,
  provider: string,
  chatModel: string,
  embeddingModel: string,
): Promise<{ settings: RuntimeProvider; ai: AiProvider }> {
  if (provider !== AUTO_PROVIDER) {
    const settings = await runtimeProvider(admin, provider, chatModel, embeddingModel)
    return { settings, ai: createAiProvider(settings) }
  }

  let parsed: unknown
  try { parsed = JSON.parse(chatModel) } catch { throw new Error('invalid_auto_route_configuration') }
  const routes = normalizeChatRoutes(parsed)
  if (!routes.length) throw new Error('invalid_auto_route_configuration')
  const providerSettings = await Promise.all(routes.map(route => runtimeProvider(admin, route.provider, route.model, embeddingModel)))
  const ai = new SelectedRoutesProvider(admin, routes, embeddingModel)
  const settings = {
    get provider() { return ai.provider },
    get chat_model() { return ai.chatModel },
    embedding_model: embeddingModel,
    max_output_tokens: providerSettings.reduce<number | null>((min, row) => {
      if (row.max_output_tokens == null) return min
      return min == null ? row.max_output_tokens : Math.min(min, row.max_output_tokens)
    }, null),
  } as RuntimeProvider
  return { settings, ai }
}
