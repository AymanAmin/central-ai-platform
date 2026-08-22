import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createAdminClient, json, preflight } from '../_shared/runtime.ts'
import { GROQ_AGENT_STRICT_MODELS, GROQ_FREE_PLAN_BY_ID } from '../_shared/groq-models.ts'

type Provider = 'gemini' | 'openrouter' | 'openai' | 'azure_openai' | 'groq'
type CatalogModel = {
  id: string
  name: string
  free: boolean
  contextLength: number | null
  structured: boolean
}

type GeminiModel = {
  name?: string
  displayName?: string
  inputTokenLimit?: number
  supportedGenerationMethods?: string[]
}
type GeminiModelsResponse = { models?: GeminiModel[]; nextPageToken?: string }
type OpenAiModelsResponse = { data?: Array<{ id?: string }> }
type OpenRouterModel = {
  id?: string
  name?: string
  context_length?: number
  architecture?: { output_modalities?: string[] }
  supported_parameters?: string[] | Record<string, unknown>
  pricing?: { prompt?: string; completion?: string }
}
type OpenRouterModelsResponse = { data?: OpenRouterModel[] }
type GroqModel = { id?: string; active?: boolean; context_window?: number }
type GroqModelsResponse = { data?: GroqModel[] }

const allowedProviders = new Set<Provider>(['gemini', 'openrouter', 'openai', 'azure_openai', 'groq'])
const appUrl = () => Deno.env.get('APP_URL')?.trim() || 'https://aymanamin.github.io/central-ai-platform/'

const uniqueModels = (models: CatalogModel[]) => {
  const map = new Map<string, CatalogModel>()
  for (const model of models) if (model.id && !map.has(model.id)) map.set(model.id, model)
  return [...map.values()]
}

const sortModels = (models: CatalogModel[]) => uniqueModels(models).sort((a, b) => {
  if (a.free !== b.free) return a.free ? -1 : 1
  return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.id.localeCompare(b.id)
})

const ensureModel = (models: CatalogModel[], id: string | null | undefined, structured: boolean) => {
  const clean = id?.trim()
  if (!clean || models.some(model => model.id === clean)) return models
  return [{ id: clean, name: clean, free: false, contextLength: null, structured }, ...models]
}

async function fetchGeminiCatalog(secret: string) {
  const rows: GeminiModel[] = []
  let pageToken = ''
  for (let page = 0; page < 4; page++) {
    const params = new URLSearchParams({ pageSize: '100' })
    if (pageToken) params.set('pageToken', pageToken)
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?${params}`, {
      headers: { 'x-goog-api-key': secret },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error(`model_catalog_provider_error:${response.status}`)
    const payload = await response.json() as GeminiModelsResponse
    rows.push(...(payload.models ?? []))
    pageToken = payload.nextPageToken ?? ''
    if (!pageToken) break
  }

  const excludedChat = /(embedding|image|imagen|veo|tts|audio|live|robotics|computer-use|deep-research)/i
  const chatModels = rows.flatMap(row => {
    const id = row.name?.replace(/^models\//, '').trim()
    const methods = row.supportedGenerationMethods ?? []
    if (!id || !methods.includes('generateContent') || excludedChat.test(id)) return []
    return [{ id, name: row.displayName?.trim() || id, free: false, contextLength: row.inputTokenLimit ?? null, structured: true } satisfies CatalogModel]
  })
  const embeddingModels = rows.flatMap(row => {
    const id = row.name?.replace(/^models\//, '').trim()
    const methods = row.supportedGenerationMethods ?? []
    if (!id || (!methods.includes('embedContent') && !methods.includes('batchEmbedContents'))) return []
    return [{ id, name: row.displayName?.trim() || id, free: false, contextLength: row.inputTokenLimit ?? null, structured: false } satisfies CatalogModel]
  })
  return { chatModels: sortModels(chatModels), embeddingModels: sortModels(embeddingModels) }
}

async function fetchOpenAiCatalog(secret: string) {
  const response = await fetch('https://api.openai.com/v1/models', {
    headers: { authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`model_catalog_provider_error:${response.status}`)
  const payload = await response.json() as OpenAiModelsResponse
  const ids = (payload.data ?? []).map(row => row.id?.trim()).filter((id): id is string => Boolean(id))
  const excluded = /(embedding|whisper|tts|dall-e|image|audio|realtime|transcrib|moderation|sora|codex|search|instruct|ft:)/i
  const chatModels = ids
    .filter(id => /^(gpt-|chatgpt-|o\d)/i.test(id) && !excluded.test(id))
    .map(id => ({ id, name: id, free: false, contextLength: null, structured: true } satisfies CatalogModel))
  const embeddingModels = ids
    .filter(id => id.startsWith('text-embedding-'))
    .map(id => ({ id, name: id, free: false, contextLength: null, structured: false } satisfies CatalogModel))
  return { chatModels: sortModels(chatModels), embeddingModels: sortModels(embeddingModels) }
}

async function fetchOpenRouterCatalog(secret: string) {
  const response = await fetch('https://openrouter.ai/api/v1/models', {
    headers: {
      authorization: `Bearer ${secret}`,
      'http-referer': appUrl(),
      'x-title': 'Central AI Platform',
    },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`model_catalog_provider_error:${response.status}`)
  const payload = await response.json() as OpenRouterModelsResponse
  const rows = payload.data ?? []
  const chatModels = rows.flatMap(row => {
    const id = row.id?.trim()
    if (!id) return []
    const output = row.architecture?.output_modalities ?? []
    const parameters = Array.isArray(row.supported_parameters) ? row.supported_parameters : Object.keys(row.supported_parameters ?? {})
    const structured = parameters.includes('structured_outputs') || parameters.includes('response_format')
    const textOutput = !output.length || output.includes('text')
    if (!textOutput || !structured || output.includes('embeddings')) return []
    const prompt = Number(row.pricing?.prompt ?? NaN)
    const completion = Number(row.pricing?.completion ?? NaN)
    const free = Number.isFinite(prompt) && Number.isFinite(completion) && prompt === 0 && completion === 0
    return [{ id, name: row.name?.trim() || id, free, contextLength: row.context_length ?? null, structured } satisfies CatalogModel]
  })
  const embeddingModels = rows.flatMap(row => {
    const id = row.id?.trim()
    if (!id) return []
    const output = row.architecture?.output_modalities ?? []
    if (!output.includes('embeddings') && !/embedding/i.test(id)) return []
    const prompt = Number(row.pricing?.prompt ?? NaN)
    const free = Number.isFinite(prompt) && prompt === 0
    return [{ id, name: row.name?.trim() || id, free, contextLength: row.context_length ?? null, structured: false } satisfies CatalogModel]
  })
  return { chatModels: sortModels(chatModels), embeddingModels: sortModels(embeddingModels) }
}

async function fetchGroqCatalog(secret: string) {
  const response = await fetch('https://api.groq.com/openai/v1/models', {
    headers: { authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`model_catalog_provider_error:${response.status}`)
  const payload = await response.json() as GroqModelsResponse
  const chatModels = (payload.data ?? []).flatMap(row => {
    const id = row.id?.trim()
    if (!id || row.active === false || !GROQ_AGENT_STRICT_MODELS.has(id)) return []
    const meta = GROQ_FREE_PLAN_BY_ID.get(id)
    return [{ id, name: meta?.name ?? id, free: Boolean(meta), contextLength: row.context_window ?? 131072, structured: true } satisfies CatalogModel]
  })
  return { chatModels: sortModels(chatModels), embeddingModels: [] as CatalogModel[] }
}

Deno.serve(async (req: Request) => {
  const cors = preflight(req)
  if (cors) return cors
  if (req.method !== 'POST') return json({ success: false, error: 'method_not_allowed' }, 405)

  try {
    const authorization = req.headers.get('authorization')
    if (!authorization?.startsWith('Bearer ')) return json({ success: false, error: 'unauthorized' }, 401)
    const admin = createAdminClient()
    const user = await admin.auth.getUser(authorization.slice(7))
    if (user.error || !user.data.user) return json({ success: false, error: 'unauthorized' }, 401)
    const profile = await admin.from('profiles').select('role,is_active').eq('id', user.data.user.id).single()
    if (profile.error || !profile.data?.is_active || profile.data.role !== 'SUPER_ADMIN') return json({ success: false, error: 'forbidden' }, 403)

    const body = await req.json().catch(() => ({})) as { provider?: string }
    const provider = body.provider as Provider | undefined
    if (!provider || !allowedProviders.has(provider)) return json({ success: false, error: 'invalid_provider' }, 400)

    const setting = await admin
      .from('ai_provider_settings')
      .select('id,provider,chat_model,embedding_model,is_default')
      .is('organization_id', null)
      .eq('provider', provider)
      .eq('is_active', true)
      .order('is_default', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (setting.error) throw setting.error
    if (!setting.data) return json({ success: false, error: 'provider_not_configured' }, 404)

    if (provider === 'azure_openai') {
      return json({
        success: true,
        provider,
        defaultChatModel: setting.data.chat_model,
        defaultEmbeddingModel: setting.data.embedding_model,
        chatModels: ensureModel([], setting.data.chat_model, true),
        embeddingModels: [],
        refreshedAt: new Date().toISOString(),
      })
    }

    const secretResult = await admin.rpc('get_ai_provider_secret', { p_provider_setting_id: setting.data.id })
    if (secretResult.error) throw secretResult.error
    const secret = typeof secretResult.data === 'string' ? secretResult.data.trim() : ''
    if (!secret) return json({ success: false, error: 'provider_secret_missing' }, 409)

    const catalog = provider === 'gemini'
      ? await fetchGeminiCatalog(secret)
      : provider === 'openrouter'
        ? await fetchOpenRouterCatalog(secret)
        : provider === 'groq'
          ? await fetchGroqCatalog(secret)
          : await fetchOpenAiCatalog(secret)

    const chatModels = ensureModel(catalog.chatModels, setting.data.chat_model, true)
    const embeddingModels = provider === 'groq' ? [] : ensureModel(catalog.embeddingModels, setting.data.embedding_model, false)
    return json({
      success: true,
      provider,
      defaultChatModel: setting.data.chat_model,
      defaultEmbeddingModel: setting.data.embedding_model,
      chatModels,
      embeddingModels,
      refreshedAt: new Date().toISOString(),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'model_catalog_failed'
    console.error('model_catalog_error', { error: message })
    return json({ success: false, error: message }, message.startsWith('model_catalog_provider_error:') ? 502 : 500)
  }
})
