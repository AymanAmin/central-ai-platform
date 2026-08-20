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

export interface EmbeddingResult { vectors: number[][]; tokens: number }

interface OpenAiResponseContent { type?: string; text?: string }
interface OpenAiResponseItem { type?: string; content?: OpenAiResponseContent[] }
interface OpenAiResponse { output_text?: string; output?: OpenAiResponseItem[]; usage?: { input_tokens?: number; output_tokens?: number } }
interface OpenAiEmbeddingResponse { data?: Array<{ embedding?: number[]; index?: number }>; usage?: { prompt_tokens?: number; total_tokens?: number } }

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

const extract = (payload: OpenAiResponse) => {
  if (payload.output_text) return payload.output_text
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === 'output_text' && content.text) return content.text
    }
  }
  throw new Error('openai_output_missing')
}

export class OpenAiProvider {
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
      value: JSON.parse(extract(payload)) as T,
      inputTokens: payload.usage?.input_tokens ?? 0,
      outputTokens: payload.usage?.output_tokens ?? 0,
    }
  }

  async chat(input: { instructions: string; userInput: string; maxOutputTokens: number }): Promise<AiChatResult> {
    const schema = {
      type: 'object',
      properties: baseProperties,
      required: ['answer', 'intent', 'requestHuman', 'actions'],
      additionalProperties: false,
    }
    const result = await this.structured<Omit<AiChatResult, 'inputTokens' | 'outputTokens'>>('central_ai_response', schema, input.instructions, input.userInput, input.maxOutputTokens)
    return { ...result.value, inputTokens: result.inputTokens, outputTokens: result.outputTokens }
  }

  async chatWithTools(input: { instructions: string; userInput: string; maxOutputTokens: number }): Promise<AiToolPlanResult> {
    const schema = {
      type: 'object',
      properties: {
        ...baseProperties,
        toolCode: { type: ['string', 'null'] },
        toolInputJson: { type: ['string', 'null'] },
      },
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
    return { text: extract(payload).trim(), inputTokens: payload.usage?.input_tokens ?? 0, outputTokens: payload.usage?.output_tokens ?? 0 }
  }
}
