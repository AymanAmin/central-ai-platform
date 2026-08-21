import type { AiChatResult, AiProvider, AiToolPlanResult, EmbeddingResult, EmbeddingTask } from './ai.ts'
import { providerRequestError } from './provider-error.ts'

interface CompletionResponse {
  choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

export interface CloudflareCredentials { accountId: string; apiToken: string }

export const parseCloudflareCredentials = (value: string): CloudflareCredentials => {
  const trimmed = value.trim()
  if (trimmed.includes('|') && !trimmed.startsWith('{')) {
    const separator = trimmed.indexOf('|')
    const accountId = trimmed.slice(0, separator).trim()
    const apiToken = trimmed.slice(separator + 1).trim()
    if (accountId && apiToken) return { accountId, apiToken }
  }
  let parsed: unknown
  try { parsed = JSON.parse(trimmed) } catch { throw new Error('cloudflare_credentials_invalid') }
  if (!parsed || typeof parsed !== 'object') throw new Error('cloudflare_credentials_invalid')
  const accountId = String((parsed as Record<string, unknown>).accountId ?? '').trim()
  const apiToken = String((parsed as Record<string, unknown>).apiToken ?? '').trim()
  if (!accountId || !apiToken) throw new Error('cloudflare_credentials_invalid')
  return { accountId, apiToken }
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

const extractContent = (payload: CompletionResponse): string => {
  const content = payload.choices?.[0]?.message?.content
  if (typeof content === 'string' && content.trim()) return content
  if (Array.isArray(content)) {
    const text = content.map(part => part.text ?? '').join('').trim()
    if (text) return text
  }
  throw new Error('cloudflare_output_missing')
}

export class CloudflareWorkersAiProvider implements AiProvider {
  readonly provider = 'cloudflare'
  private endpoint: string

  constructor(private credentials: CloudflareCredentials, readonly chatModel: string, readonly embeddingModel: string) {
    this.endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(credentials.accountId)}/ai/v1/chat/completions`
  }

  async embedding(_texts: string[], _task: EmbeddingTask = 'RETRIEVAL_QUERY'): Promise<EmbeddingResult> {
    throw new Error('embedding_provider_not_supported:cloudflare')
  }

  private async completion<T>(schema: Record<string, unknown> | null, instructions: string, input: string, maxOutputTokens: number): Promise<{ value: T; inputTokens: number; outputTokens: number }> {
    const body: Record<string, unknown> = {
      model: this.chatModel,
      messages: [
        { role: 'system', content: instructions },
        { role: 'user', content: input },
      ],
      max_tokens: maxOutputTokens,
      temperature: 0.15,
    }
    if (schema) body.response_format = { type: 'json_schema', json_schema: schema }

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.credentials.apiToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    })
    if (!response.ok) throw await providerRequestError(this.provider, response)
    const payload = await response.json() as CompletionResponse
    const text = extractContent(payload).trim()
    return {
      value: (schema ? JSON.parse(text) : text) as T,
      inputTokens: payload.usage?.prompt_tokens ?? 0,
      outputTokens: payload.usage?.completion_tokens ?? 0,
    }
  }

  async chat(input: { instructions: string; userInput: string; maxOutputTokens: number }): Promise<AiChatResult> {
    const schema = { type: 'object', properties: baseProperties, required: ['answer', 'intent', 'requestHuman', 'actions'], additionalProperties: false }
    const result = await this.completion<Omit<AiChatResult, 'inputTokens' | 'outputTokens'>>(schema, input.instructions, input.userInput, input.maxOutputTokens)
    return { ...result.value, inputTokens: result.inputTokens, outputTokens: result.outputTokens }
  }

  async chatWithTools(input: { instructions: string; userInput: string; maxOutputTokens: number }): Promise<AiToolPlanResult> {
    const schema = {
      type: 'object',
      properties: { ...baseProperties, toolCode: { type: ['string', 'null'] }, toolInputJson: { type: ['string', 'null'] } },
      required: ['answer', 'intent', 'requestHuman', 'actions', 'toolCode', 'toolInputJson'],
      additionalProperties: false,
    }
    const result = await this.completion<Omit<AiToolPlanResult, 'inputTokens' | 'outputTokens'>>(schema, input.instructions, input.userInput, input.maxOutputTokens)
    return { ...result.value, inputTokens: result.inputTokens, outputTokens: result.outputTokens }
  }

  async text(instructions: string, input: string, maxOutputTokens = 500): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
    const result = await this.completion<string>(null, instructions, input, maxOutputTokens)
    return { text: result.value.trim(), inputTokens: result.inputTokens, outputTokens: result.outputTokens }
  }
}
