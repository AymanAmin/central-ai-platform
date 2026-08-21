import { createAdminClient } from './runtime.ts'
import {
  createAiProvider as createBaseAiProvider,
  type AiChatResult,
  type AiProvider,
  type AiProviderSettings,
  type AiToolPlanResult,
  type EmbeddingResult,
  type EmbeddingTask,
} from './ai.ts'
import { CloudflareWorkersAiProvider, parseCloudflareCredentials } from './cloudflare.ts'
import { GroqProvider } from './groq.ts'
import { AiProviderRequestError, providerCooldownUntil } from './provider-error.ts'

export type { AiChatResult, AiProvider, AiProviderSettings, AiToolPlanResult, EmbeddingResult, EmbeddingTask } from './ai.ts'

const newProviders = new Set(['groq', 'cloudflare'])

const resolveVaultKey = async (settings: AiProviderSettings): Promise<string | null> => {
  const admin = createAdminClient()
  let settingId = settings.id
  if (!settingId) {
    const setting = await admin
      .from('ai_provider_settings')
      .select('id')
      .is('organization_id', null)
      .eq('provider', settings.provider)
      .eq('is_active', true)
      .order('is_default', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (setting.error) throw new Error('ai_provider_secret_lookup_failed')
    settingId = setting.data?.id
  }
  if (!settingId) return null
  const secret = await admin.rpc('get_ai_provider_secret', { p_provider_setting_id: settingId })
  if (secret.error) throw new Error('ai_provider_secret_lookup_failed')
  return typeof secret.data === 'string' && secret.data.trim() ? secret.data.trim() : null
}

const directNewProvider = (settings: AiProviderSettings, secret?: string): AiProvider => {
  if (settings.provider === 'groq') {
    const key = secret || Deno.env.get('GROQ_API_KEY')
    if (!key) throw new Error('groq_api_key_missing')
    return new GroqProvider(key, settings.chat_model, settings.embedding_model)
  }
  if (settings.provider === 'cloudflare') {
    const raw = secret || (() => {
      const accountId = Deno.env.get('CLOUDFLARE_ACCOUNT_ID')?.trim()
      const apiToken = Deno.env.get('CLOUDFLARE_API_TOKEN')?.trim()
      return accountId && apiToken ? `${accountId}|${apiToken}` : undefined
    })()
    if (!raw) throw new Error('cloudflare_credentials_missing')
    return new CloudflareWorkersAiProvider(parseCloudflareCredentials(raw), settings.chat_model, settings.embedding_model)
  }
  throw new Error('ai_provider_not_configured')
}

const normalizeFailure = (provider: string, error: unknown): AiProviderRequestError | null => {
  if (error instanceof AiProviderRequestError) return error
  const message = error instanceof Error ? error.message : ''
  if (/(?:api_key_missing|credentials_missing|credentials_invalid|secret_lookup_failed)/.test(message)) {
    return new AiProviderRequestError(provider, 401, 'auth')
  }
  const match = message.match(/chat_provider_error:(\d{3})/)
  if (!match) return null
  const status = Number(match[1])
  if (status === 429) return new AiProviderRequestError(provider, status, 'quota')
  if (status === 401 || status === 403) return new AiProviderRequestError(provider, status, 'auth')
  if (status >= 500) return new AiProviderRequestError(provider, status, 'unavailable')
  return null
}

class MonitoredChatProvider implements AiProvider {
  readonly provider: string
  readonly chatModel: string
  readonly embeddingModel: string

  constructor(private inner: AiProvider) {
    this.provider = inner.provider
    this.chatModel = inner.chatModel
    this.embeddingModel = inner.embeddingModel
  }

  private async rememberFailure(error: unknown) {
    const normalized = normalizeFailure(this.provider, error)
    if (!normalized) return
    const admin = createAdminClient()
    const result = await admin.from('ai_provider_global_cooldowns').upsert({
      provider: this.provider,
      model: this.chatModel,
      blocked_until: providerCooldownUntil(normalized).toISOString(),
      reason: normalized.kind,
      http_status: normalized.status,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'provider,model' })
    if (result.error) console.warn('ai_provider_global_cooldown_write_failed', result.error.message)
  }

  private async clearFailure() {
    const admin = createAdminClient()
    const result = await admin.from('ai_provider_global_cooldowns').delete().eq('provider', this.provider).eq('model', this.chatModel)
    if (result.error) console.warn('ai_provider_global_cooldown_clear_failed', result.error.message)
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      const result = await operation()
      await this.clearFailure()
      return result
    } catch (error) {
      await this.rememberFailure(error)
      throw error
    }
  }

  embedding(texts: string[], task?: EmbeddingTask): Promise<EmbeddingResult> {
    return this.inner.embedding(texts, task)
  }
  chat(input: { instructions: string; userInput: string; maxOutputTokens: number }): Promise<AiChatResult> {
    return this.run(() => this.inner.chat(input))
  }
  chatWithTools(input: { instructions: string; userInput: string; maxOutputTokens: number }): Promise<AiToolPlanResult> {
    return this.run(() => this.inner.chatWithTools(input))
  }
  text(instructions: string, input: string, maxOutputTokens = 500): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
    return this.run(() => this.inner.text(instructions, input, maxOutputTokens))
  }
}

class VaultNewProvider implements AiProvider {
  readonly provider: string
  readonly chatModel: string
  readonly embeddingModel: string
  private resolved?: Promise<AiProvider>

  constructor(private settings: AiProviderSettings) {
    this.provider = settings.provider
    this.chatModel = settings.chat_model
    this.embeddingModel = settings.embedding_model
  }

  private getProvider() {
    if (!this.resolved) this.resolved = resolveVaultKey(this.settings).then(secret => directNewProvider(this.settings, secret ?? undefined))
    return this.resolved
  }
  async embedding(texts: string[], task?: EmbeddingTask) { return (await this.getProvider()).embedding(texts, task) }
  async chat(input: { instructions: string; userInput: string; maxOutputTokens: number }) { return (await this.getProvider()).chat(input) }
  async chatWithTools(input: { instructions: string; userInput: string; maxOutputTokens: number }) { return (await this.getProvider()).chatWithTools(input) }
  async text(instructions: string, input: string, maxOutputTokens = 500) { return (await this.getProvider()).text(instructions, input, maxOutputTokens) }
}

export function createAiProvider(settings: AiProviderSettings, explicitKey?: string): AiProvider {
  const provider = newProviders.has(settings.provider)
    ? (explicitKey ? directNewProvider(settings, explicitKey) : new VaultNewProvider(settings))
    : createBaseAiProvider(settings, explicitKey)
  return new MonitoredChatProvider(provider)
}
