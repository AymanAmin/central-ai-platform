import type { AiAction, AiChatResult, AiProvider, AiToolPlanResult, EmbeddingResult, EmbeddingTask } from './ai.ts'
import { createAdminClient } from './runtime.ts'

interface OpenRouterChatResponse {
  choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  error?: { message?: string }
}

interface OpenRouterEmbeddingResponse {
  data?: Array<{ embedding?: number[]; index?: number }>
  usage?: { prompt_tokens?: number; total_tokens?: number }
  error?: { message?: string }
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

function extractContent(payload: OpenRouterChatResponse): string {
  const content = payload.choices?.[0]?.message?.content
  if (typeof content === 'string' && content.trim()) return content
  if (Array.isArray(content)) {
    const text = content.map(part => part.text ?? '').join('').trim()
    if (text) return text
  }
  throw new Error('openrouter_output_missing')
}

export class OpenRouterProvider implements AiProvider {
  readonly provider = 'openrouter'
  private geminiKey?: Promise<string>

  constructor(private key: string, readonly chatModel: string, readonly embeddingModel: string) {}

  private headers() {
    return {
      authorization: `Bearer ${this.key}`,
      'content-type': 'application/json',
      'http-referer': Deno.env.get('APP_URL')?.trim() || 'https://aymanamin.github.io/central-ai-platform/',
      'x-title': 'Central AI Platform',
    }
  }

  private getGeminiEmbeddingKey(): Promise<string> {
    if (!this.geminiKey) {
      this.geminiKey = (async () => {
        const admin = createAdminClient()
        const setting = await admin
          .from('ai_provider_settings')
          .select('id')
          .is('organization_id', null)
          .eq('provider', 'gemini')
          .eq('is_active', true)
          .order('is_default', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (setting.error || !setting.data?.id) throw new Error('gemini_embedding_provider_missing')
        const secret = await admin.rpc('get_ai_provider_secret', { p_provider_setting_id: setting.data.id })
        if (secret.error || typeof secret.data !== 'string' || !secret.data.trim()) throw new Error('gemini_api_key_missing')
        return secret.data.trim()
      })()
    }
    return this.geminiKey
  }

  private async geminiEmbedding(texts: string[], task: EmbeddingTask): Promise<EmbeddingResult> {
    const key = await this.getGeminiEmbeddingKey()
    const modelPath = `models/${this.embeddingModel.replace(/^models\//, '')}`
    const batch = texts.length > 1
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/${modelPath}:${batch ? 'batchEmbedContents' : 'embedContent'}`
    const requestFor = (text: string) => ({
      model: modelPath,
      content: { parts: [{ text }] },
      taskType: task,
      outputDimensionality: 1536,
    })
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
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

  async embedding(texts: string[], task: EmbeddingTask = 'RETRIEVAL_QUERY'): Promise<EmbeddingResult> {
    if (!texts.length) return { vectors: [], tokens: 0 }

    // Knowledge vectors were generated with Gemini. When OpenRouter is selected for
    // chat, keep queries/documents in the same embedding space instead of mixing
    // mathematically incompatible 1536-dimensional vectors from another model.
    if (this.embeddingModel.replace(/^models\//, '').startsWith('gemini-')) {
      return this.geminiEmbedding(texts, task)
    }

    const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ model: this.embeddingModel, input: texts, dimensions: 1536 }),
      signal: AbortSignal.timeout(45_000),
    })
    if (!response.ok) throw new Error(`embedding_provider_error:${response.status}`)
    const payload = await response.json() as OpenRouterEmbeddingResponse
    const rows = [...(payload.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    const vectors = rows.map(row => row.embedding).filter((value): value is number[] => Array.isArray(value))
    if (vectors.length !== texts.length || vectors.some(vector => vector.length !== 1536)) throw new Error('embedding_count_mismatch')
    return { vectors, tokens: payload.usage?.prompt_tokens ?? payload.usage?.total_tokens ?? 0 }
  }

  private async completion<T>(schema: Record<string, unknown> | null, name: string, instructions: string, input: string, maxOutputTokens: number): Promise<{ value: T; inputTokens: number; outputTokens: number }> {
    const body: Record<string, unknown> = {
      model: this.chatModel,
      messages: [
        { role: 'system', content: instructions },
        { role: 'user', content: input },
      ],
      max_tokens: maxOutputTokens,
      temperature: 0.2,
    }
    if (schema) {
      body.response_format = { type: 'json_schema', json_schema: { name, strict: true, schema } }
      // The free router must choose a model/provider that honors structured JSON.
      body.provider = { require_parameters: true }
    }
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    })
    if (!response.ok) throw new Error(`chat_provider_error:${response.status}`)
    const payload = await response.json() as OpenRouterChatResponse
    const text = extractContent(payload).trim()
    return {
      value: (schema ? JSON.parse(text) : text) as T,
      inputTokens: payload.usage?.prompt_tokens ?? 0,
      outputTokens: payload.usage?.completion_tokens ?? 0,
    }
  }

  async chat(input: { instructions: string; userInput: string; maxOutputTokens: number }): Promise<AiChatResult> {
    const schema = { type: 'object', properties: baseProperties, required: ['answer', 'intent', 'requestHuman', 'actions'], additionalProperties: false }
    const result = await this.completion<Omit<AiChatResult, 'inputTokens' | 'outputTokens'>>(schema, 'central_ai_response', input.instructions, input.userInput, input.maxOutputTokens)
    return { ...result.value, inputTokens: result.inputTokens, outputTokens: result.outputTokens }
  }

  async chatWithTools(input: { instructions: string; userInput: string; maxOutputTokens: number }): Promise<AiToolPlanResult> {
    const schema = {
      type: 'object',
      properties: { ...baseProperties, toolCode: { type: ['string', 'null'] }, toolInputJson: { type: ['string', 'null'] } },
      required: ['answer', 'intent', 'requestHuman', 'actions', 'toolCode', 'toolInputJson'],
      additionalProperties: false,
    }
    const result = await this.completion<Omit<AiToolPlanResult, 'inputTokens' | 'outputTokens'>>(schema, 'central_ai_tool_plan', input.instructions, input.userInput, input.maxOutputTokens)
    return { ...result.value, inputTokens: result.inputTokens, outputTokens: result.outputTokens }
  }

  async text(instructions: string, input: string, maxOutputTokens = 500): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
    const result = await this.completion<string>(null, 'central_ai_text', instructions, input, maxOutputTokens)
    return { text: result.value.trim(), inputTokens: result.inputTokens, outputTokens: result.outputTokens }
  }
}

export type { AiAction }
