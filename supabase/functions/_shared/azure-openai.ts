import type { AiChatResult, AiProvider, AiToolPlanResult, EmbeddingResult, EmbeddingTask } from './ai.ts'

interface AzureSecretPayload {
  apiKey?: unknown
  endpoint?: unknown
}

interface OpenAiResponseContent { type?: string; text?: string }
interface OpenAiResponseItem { type?: string; content?: OpenAiResponseContent[] }
interface OpenAiResponse { output_text?: string; output?: OpenAiResponseItem[]; usage?: { input_tokens?: number; output_tokens?: number } }

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

function normalizeEndpoint(raw: string) {
  let url: URL
  try { url = new URL(raw) } catch { throw new Error('azure_openai_endpoint_invalid') }
  const host = url.hostname.toLowerCase()
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('azure_openai_endpoint_invalid')
  if (url.pathname !== '/' && url.pathname !== '') throw new Error('azure_openai_endpoint_invalid')
  if (!/^[a-z0-9-]+\.openai\.azure\.com$/i.test(host)) throw new Error('azure_openai_endpoint_invalid')
  return `https://${host}`
}

export function resolveAzureOpenAiCredentials(secret?: string | null) {
  let apiKey = ''
  let endpoint = ''
  const clean = secret?.trim() ?? ''
  if (clean) {
    try {
      const parsed = JSON.parse(clean) as AzureSecretPayload
      apiKey = typeof parsed.apiKey === 'string' ? parsed.apiKey.trim() : ''
      endpoint = typeof parsed.endpoint === 'string' ? parsed.endpoint.trim() : ''
    } catch {
      apiKey = clean
    }
  }
  apiKey ||= Deno.env.get('AZURE_OPENAI_API_KEY')?.trim() ?? ''
  endpoint ||= Deno.env.get('AZURE_OPENAI_ENDPOINT')?.trim() ?? ''
  if (!apiKey || apiKey.length < 20 || apiKey.length > 512) throw new Error('azure_openai_api_key_missing')
  if (!endpoint) throw new Error('azure_openai_endpoint_missing')
  return { apiKey, endpoint: normalizeEndpoint(endpoint) }
}

const extractText = (payload: OpenAiResponse) => {
  if (payload.output_text) return payload.output_text
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === 'output_text' && content.text) return content.text
    }
  }
  throw new Error('azure_openai_output_missing')
}

export class AzureOpenAiProvider implements AiProvider {
  readonly provider = 'azure_openai'

  constructor(
    private apiKey: string,
    private endpoint: string,
    readonly chatModel: string,
    readonly embeddingModel: string,
  ) {}

  async embedding(_texts: string[], _task?: EmbeddingTask): Promise<EmbeddingResult> {
    throw new Error('azure_openai_embeddings_not_supported')
  }

  private async request(body: Record<string, unknown>) {
    const response = await fetch(`${this.endpoint}/openai/v1/responses`, {
      method: 'POST',
      headers: { 'api-key': this.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    })
    if (!response.ok) throw new Error(`chat_provider_error:${response.status}`)
    return await response.json() as OpenAiResponse
  }

  private async structured<T>(name: string, schema: Record<string, unknown>, instructions: string, input: string, maxOutputTokens: number) {
    const payload = await this.request({
      model: this.chatModel,
      instructions,
      input,
      max_output_tokens: maxOutputTokens,
      text: { format: { type: 'json_schema', name, strict: true, schema } },
    })
    return {
      value: JSON.parse(extractText(payload)) as T,
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

  async text(instructions: string, input: string, maxOutputTokens = 500) {
    const payload = await this.request({ model: this.chatModel, instructions, input, max_output_tokens: maxOutputTokens })
    return { text: extractText(payload).trim(), inputTokens: payload.usage?.input_tokens ?? 0, outputTokens: payload.usage?.output_tokens ?? 0 }
  }
}

export function createAzureOpenAiProvider(settings: { chat_model: string; embedding_model: string }, secret?: string | null) {
  const credentials = resolveAzureOpenAiCredentials(secret)
  return new AzureOpenAiProvider(credentials.apiKey, credentials.endpoint, settings.chat_model, settings.embedding_model)
}
