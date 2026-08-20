import { createAdminClient } from './runtime.ts'

export interface AiAction {
  type: 'open_url' | 'reply_option' | 'call_phone' | 'download_file' | 'human_handoff' | 'request_location' | 'open_screen' | 'custom'
  label: string | null
  url: string | null
  phone: string | null
  screen: string | null
  value: string | null
}

export interface AiChatResult {
  answer: string
  intent: string
  requestHuman: boolean
  actions: AiAction[]
  inputTokens: number
  outputTokens: number
}

export interface AiToolPlanResult extends AiChatResult {
  toolCode: string | null
  toolInputJson: string | null
}

export type EmbeddingTask = 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT'
export interface EmbeddingResult { vectors: number[][]; tokens: number }
export interface AiProviderSettings { id?: string; provider: string; chat_model: string; embedding_model: string }

export interface AiProvider {
  readonly provider: string
  readonly chatModel: string
  readonly embeddingModel: string
  embedding(texts: string[], task?: EmbeddingTask): Promise<EmbeddingResult>
  chat(input: { instructions: string; userInput: string; maxOutputTokens: number }): Promise<AiChatResult>
  chatWithTools(input: { instructions: string; userInput: string; maxOutputTokens: number }): Promise<AiToolPlanResult>
  text(instructions: string, input: string, maxOutputTokens?: number): Promise<{ text: string; inputTokens: number; outputTokens: number }>
}

interface OpenAiResponseContent { type?: string; text?: string }
interface OpenAiResponseItem { type?: string; content?: OpenAiResponseContent[] }
interface OpenAiResponse { output_text?: string; output?: OpenAiResponseItem[]; usage?: { input_tokens?: number; output_tokens?: number } }
interface OpenAiEmbeddingResponse { data?: Array<{ embedding?: number[]; index?: number }>; usage?: { prompt_tokens?: number; total_tokens?: number } }

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> }
    finishReason?: string
  }>
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
  promptFeedback?: { blockReason?: string }
}
interface GeminiEmbeddingResponse {
  embedding?: { values?: number[] }
  embeddings?: Array<{ values?: number[] }>
  usageMetadata?: { promptTokenCount?: number }
}

const actionSchema = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['open_url', 'reply_option', 'call_phone', 'download_file', 'human_handoff', 'request_location', 'open_screen', 'custom'] },
    label: { type: ['string', 'null'] },
    url: { type: ['string', 'null'] },
    phone: { type: ['string', 'null'] },
    screen: { type: ['string', 'null'] },
    value: { type: ['string', 'null'] },
  },
  required: ['type', 'label', 'url', 'phone', 'screen', 'value'],
  additionalProperties: false,
}

const baseProperties = {
  answer: { type: 'string' },
  intent: { type: 'string' },
  requestHuman: { type: 'boolean' },
  actions: { type: 'array', maxItems: 4, items: actionSchema },
}

const extractOpenAi = (payload: OpenAiResponse) => {
  if (payload.output_text) return payload.output_text
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === 'output_text' && content.text) return content.text
    }
  }
  throw new Error('openai_output_missing')
}

const extractGemini = (payload: GeminiGenerateContentResponse) => {
  for (const candidate of payload.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      if (part.text) return part.text
    }
  }
  if (payload.promptFeedback?.blockReason) throw new Error(`gemini_blocked:${payload.promptFeedback.blockReason}`)
  throw new Error('gemini_output_missing')
}

export class OpenAiProvider implements AiProvider {
  readonly provider = 'openai'
  constructor(private key: string, readonly chatModel: string, readonly embeddingModel: string) {}

  async embedding(texts: string[]): Promise<EmbeddingResult> {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.embeddingModel, input: texts, dimensions: 1536 }),
      signal: AbortSignal.timeout(45_000),
    })
    if (!response.ok) throw new Error(`embedding_provider_error:${response.status}`)
    const payload = await response.json() as OpenAiEmbeddingResponse
    const data = [...(payload.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    const vectors = data.map(item => item.embedding).filter((item): item is number[] => Array.isArray(item))
    if (vectors.length !== texts.length) throw new Error('embedding_count_mismatch')
    return { vectors, tokens: payload.usage?.prompt_tokens ?? payload.usage?.total_tokens ?? 0 }
  }

  private async structured<T>(name: string, schema: Record<string, unknown>, instructions: string, input: string, maxOutputTokens: number): Promise<{ value: T; inputTokens: number; outputTokens: number }> {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.chatModel,
        instructions,
        input,
        max_output_tokens: maxOutputTokens,
        text: { format: { type: 'json_schema', name, strict: true, schema } },
      }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!response.ok) throw new Error(`chat_provider_error:${response.status}`)
    const payload = await response.json() as OpenAiResponse
    return {
      value: JSON.parse(extractOpenAi(payload)) as T,
      inputTokens: payload.usage?.input_tokens ?? 0,
      outputTokens: payload.usage?.output_tokens ?? 0,
    }
  }

  async chat(input: { instructions: string; userInput: string; maxOutputTokens: number }): Promise<AiChatResult> {
    const schema = { type: 'object', properties: baseProperties, required: ['answer', 'intent', 'requestHuman', 'actions'], additionalProperties: false }
    const result = await this.structured<Omit<AiChatResult, 'inputTokens' | 'outputTokens'>>('central_ai_response', schema, input.instructions, input.userInput, input.maxOutputTokens)
    return { ...result.value, inputTokens: result.inputTokens, outputTokens: result.outputTokens }
  }

  async chatWithTools(input: { instructions: string; userInput: string; maxOutputTokens: number }): Promise<AiToolPlanResult> {
    const schema = {
      type: 'object',
      properties: { ...baseProperties, toolCode: { type: ['string', 'null'] }, toolInputJson: { type: ['string', 'null'] } },
      required: ['answer', 'intent', 'requestHuman', 'actions', 'toolCode', 'toolInputJson'],
      additionalProperties: false,
    }
    const result = await this.structured<Omit<AiToolPlanResult, 'inputTokens' | 'outputTokens'>>('central_ai_tool_plan', schema, input.instructions, input.userInput, input.maxOutputTokens)
    return { ...result.value, inputTokens: result.inputTokens, outputTokens: result.outputTokens }
  }

  async text(instructions: string, input: string, maxOutputTokens = 500): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.chatModel, instructions, input, max_output_tokens: maxOutputTokens }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!response.ok) throw new Error(`chat_provider_error:${response.status}`)
    const payload = await response.json() as OpenAiResponse
    return { text: extractOpenAi(payload).trim(), inputTokens: payload.usage?.input_tokens ?? 0, outputTokens: payload.usage?.output_tokens ?? 0 }
  }
}

export class GeminiProvider implements AiProvider {
  readonly provider = 'gemini'
  constructor(private key: string, readonly chatModel: string, readonly embeddingModel: string) {}

  async embedding(texts: string[], task: EmbeddingTask = 'RETRIEVAL_QUERY'): Promise<EmbeddingResult> {
    if (!texts.length) return { vectors: [], tokens: 0 }
    const modelPath = `models/${this.embeddingModel.replace(/^models\//, '')}`
    const batch = texts.length > 1
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/${modelPath}:${batch ? 'batchEmbedContents' : 'embedContent'}`
    const requestFor = (text: string) => ({
      model: modelPath,
      content: { parts: [{ text }] },
      // The REST endpoint currently honors these fields at request level.
      // Using embedContentConfig here returns the default 3072 dimensions,
      // which is incompatible with our vector(1536) schema.
      taskType: task,
      outputDimensionality: 1536,
    })
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'x-goog-api-key': this.key, 'content-type': 'application/json' },
      body: JSON.stringify(batch ? { requests: texts.map(requestFor) } : requestFor(texts[0]!)),
      signal: AbortSignal.timeout(45_000),
    })
    if (!response.ok) throw new Error(`embedding_provider_error:${response.status}`)
    const payload = await response.json() as GeminiEmbeddingResponse
    const vectors = batch
      ? (payload.embeddings ?? []).map(item => item.values).filter((item): item is number[] => Array.isArray(item))
      : (Array.isArray(payload.embedding?.values) ? [payload.embedding.values] : [])
    if (vectors.length !== texts.length || vectors.some(vector => vector.length !== 1536)) throw new Error('embedding_count_mismatch')
    return { vectors, tokens: payload.usageMetadata?.promptTokenCount ?? 0 }
  }

  private async interaction<T>(schema: Record<string, unknown> | null, instructions: string, input: string, maxOutputTokens: number): Promise<{ value: T; inputTokens: number; outputTokens: number }> {
    const modelPath = `models/${this.chatModel.replace(/^models\//, '')}`
    const generationConfig: Record<string, unknown> = { maxOutputTokens }
    if (schema) {
      generationConfig.responseMimeType = 'application/json'
      generationConfig.responseJsonSchema = schema
    }
    const body = {
      contents: [{ role: 'user', parts: [{ text: input }] }],
      systemInstruction: { parts: [{ text: instructions }] },
      generationConfig,
    }
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': this.key, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    })
    if (!response.ok) throw new Error(`chat_provider_error:${response.status}`)
    const payload = await response.json() as GeminiGenerateContentResponse
    const text = extractGemini(payload).trim()
    return {
      value: (schema ? JSON.parse(text) : text) as T,
      inputTokens: payload.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: payload.usageMetadata?.candidatesTokenCount ?? 0,
    }
  }

  async chat(input: { instructions: string; userInput: string; maxOutputTokens: number }): Promise<AiChatResult> {
    const schema = { type: 'object', properties: baseProperties, required: ['answer', 'intent', 'requestHuman', 'actions'], additionalProperties: false }
    const result = await this.interaction<Omit<AiChatResult, 'inputTokens' | 'outputTokens'>>(schema, input.instructions, input.userInput, input.maxOutputTokens)
    return { ...result.value, inputTokens: result.inputTokens, outputTokens: result.outputTokens }
  }

  async chatWithTools(input: { instructions: string; userInput: string; maxOutputTokens: number }): Promise<AiToolPlanResult> {
    const schema = {
      type: 'object',
      properties: { ...baseProperties, toolCode: { type: ['string', 'null'] }, toolInputJson: { type: ['string', 'null'] } },
      required: ['answer', 'intent', 'requestHuman', 'actions', 'toolCode', 'toolInputJson'],
      additionalProperties: false,
    }
    const result = await this.interaction<Omit<AiToolPlanResult, 'inputTokens' | 'outputTokens'>>(schema, input.instructions, input.userInput, input.maxOutputTokens)
    return { ...result.value, inputTokens: result.inputTokens, outputTokens: result.outputTokens }
  }

  async text(instructions: string, input: string, maxOutputTokens = 500): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
    const result = await this.interaction<string>(null, instructions, input, maxOutputTokens)
    return { text: result.value.trim(), inputTokens: result.inputTokens, outputTokens: result.outputTokens }
  }
}

function directProvider(settings: AiProviderSettings, key?: string): AiProvider {
  if (settings.provider === 'gemini') {
    const resolved = key || Deno.env.get('GEMINI_API_KEY')
    if (!resolved) throw new Error('gemini_api_key_missing')
    return new GeminiProvider(resolved, settings.chat_model, settings.embedding_model)
  }
  if (settings.provider === 'openai') {
    const resolved = key || Deno.env.get('OPENAI_API_KEY')
    if (!resolved) throw new Error('openai_api_key_missing')
    return new OpenAiProvider(resolved, settings.chat_model, settings.embedding_model)
  }
  throw new Error('ai_provider_not_configured')
}

async function resolveVaultKey(settings: AiProviderSettings): Promise<string | null> {
  const admin = createAdminClient()
  let settingId = settings.id
  if (!settingId) {
    const setting = await admin
      .from('ai_provider_settings')
      .select('id')
      .is('organization_id', null)
      .eq('provider', settings.provider)
      .eq('is_active', true)
      .eq('is_default', true)
      .maybeSingle()
    if (setting.error) throw new Error('ai_provider_secret_lookup_failed')
    settingId = setting.data?.id
  }
  if (!settingId) return null
  const secret = await admin.rpc('get_ai_provider_secret', { p_provider_setting_id: settingId })
  if (secret.error) throw new Error('ai_provider_secret_lookup_failed')
  return typeof secret.data === 'string' && secret.data.trim() ? secret.data : null
}

class VaultBackedProvider implements AiProvider {
  readonly provider: string
  readonly chatModel: string
  readonly embeddingModel: string
  private resolved?: Promise<AiProvider>

  constructor(private settings: AiProviderSettings) {
    this.provider = settings.provider
    this.chatModel = settings.chat_model
    this.embeddingModel = settings.embedding_model
  }

  private getProvider(): Promise<AiProvider> {
    if (!this.resolved) {
      this.resolved = resolveVaultKey(this.settings).then(key => directProvider(this.settings, key ?? undefined))
    }
    return this.resolved
  }

  async embedding(texts: string[], task?: EmbeddingTask): Promise<EmbeddingResult> {
    return (await this.getProvider()).embedding(texts, task)
  }

  async chat(input: { instructions: string; userInput: string; maxOutputTokens: number }): Promise<AiChatResult> {
    return (await this.getProvider()).chat(input)
  }

  async chatWithTools(input: { instructions: string; userInput: string; maxOutputTokens: number }): Promise<AiToolPlanResult> {
    return (await this.getProvider()).chatWithTools(input)
  }

  async text(instructions: string, input: string, maxOutputTokens = 500): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
    return (await this.getProvider()).text(instructions, input, maxOutputTokens)
  }
}

export function createAiProvider(settings: AiProviderSettings, explicitKey?: string): AiProvider {
  if (explicitKey) return directProvider(settings, explicitKey)
  if (!['gemini', 'openai'].includes(settings.provider)) throw new Error('ai_provider_not_configured')
  return new VaultBackedProvider(settings)
}

export const isAiProviderUnavailableError = (message: string) => message === 'ai_provider_not_configured' || message === 'gemini_api_key_missing' || message === 'openai_api_key_missing' || message === 'ai_provider_secret_lookup_failed'
