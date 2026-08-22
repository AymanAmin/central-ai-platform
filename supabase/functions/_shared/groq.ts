import type { AiChatResult, AiProvider, AiToolPlanResult, EmbeddingResult, EmbeddingTask } from './ai.ts'

interface GroqChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
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

function extractContent(payload: GroqChatResponse): string {
  const content = payload.choices?.[0]?.message?.content
  if (typeof content === 'string' && content.trim()) return content.trim()
  throw new Error('groq_output_missing')
}

export class GroqProvider implements AiProvider {
  readonly provider = 'groq'

  constructor(private key: string, readonly chatModel: string, readonly embeddingModel: string) {}

  async embedding(_texts: string[], _task?: EmbeddingTask): Promise<EmbeddingResult> {
    throw new Error('groq_embeddings_not_supported')
  }

  private async completion<T>(
    schema: Record<string, unknown> | null,
    name: string,
    instructions: string,
    input: string,
    maxOutputTokens: number,
  ): Promise<{ value: T; inputTokens: number; outputTokens: number }> {
    const body: Record<string, unknown> = {
      model: this.chatModel,
      messages: [
        { role: 'system', content: instructions },
        { role: 'user', content: input },
      ],
      max_completion_tokens: maxOutputTokens,
      temperature: 0.2,
    }
    if (schema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: { name, strict: true, schema },
      }
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    })
    if (!response.ok) throw new Error(`chat_provider_error:${response.status}`)
    const payload = await response.json() as GroqChatResponse
    const text = extractContent(payload)
    return {
      value: (schema ? JSON.parse(text) : text) as T,
      inputTokens: payload.usage?.prompt_tokens ?? 0,
      outputTokens: payload.usage?.completion_tokens ?? 0,
    }
  }

  async chat(input: { instructions: string; userInput: string; maxOutputTokens: number }): Promise<AiChatResult> {
    const schema = {
      type: 'object',
      properties: baseProperties,
      required: ['answer', 'intent', 'requestHuman', 'actions'],
      additionalProperties: false,
    }
    const result = await this.completion<Omit<AiChatResult, 'inputTokens' | 'outputTokens'>>(
      schema,
      'central_ai_response',
      input.instructions,
      input.userInput,
      input.maxOutputTokens,
    )
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
    const result = await this.completion<Omit<AiToolPlanResult, 'inputTokens' | 'outputTokens'>>(
      schema,
      'central_ai_tool_plan',
      input.instructions,
      input.userInput,
      input.maxOutputTokens,
    )
    return { ...result.value, inputTokens: result.inputTokens, outputTokens: result.outputTokens }
  }

  async text(instructions: string, input: string, maxOutputTokens = 500): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
    const result = await this.completion<string>(null, 'central_ai_text', instructions, input, maxOutputTokens)
    return { text: result.value.trim(), inputTokens: result.inputTokens, outputTokens: result.outputTokens }
  }
}

export function createGroqProvider(settings: { chat_model: string; embedding_model: string }, secret?: string | null) {
  const key = secret?.trim() || Deno.env.get('GROQ_API_KEY')?.trim() || ''
  if (!key) throw new Error('groq_api_key_missing')
  if (key.length < 20 || key.length > 512) throw new Error('groq_api_key_invalid')
  return new GroqProvider(key, settings.chat_model, settings.embedding_model)
}
