import type { AiAction, AiChatResult, AiProvider, AiToolPlanResult, EmbeddingResult, EmbeddingTask } from './ai.ts'

interface GroqChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

interface GroqErrorResponse {
  error?: { message?: string; type?: string; code?: string | null }
}

type GroqAction = {
  type: AiAction['type']
  label: string | null
  target: string | null
  value: string | null
}

const actionTypes: AiAction['type'][] = ['open_url', 'reply_option', 'call_phone', 'download_file', 'human_handoff', 'request_location', 'open_screen', 'custom']
const actionSchema = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: actionTypes },
    label: { type: ['string', 'null'] },
    target: { type: ['string', 'null'] },
    value: { type: ['string', 'null'] },
  },
  required: ['type', 'label', 'target', 'value'],
  additionalProperties: false,
}

const baseProperties = {
  answer: { type: 'string' },
  intent: { type: 'string' },
  requestHuman: { type: 'boolean' },
  actions: { type: 'array', items: actionSchema },
}

const actionContract = `For every action, return exactly these fields: type, label, target, value. Every field is required; use null when a field is unused. Put the URL in target for open_url/download_file, the phone number in target for call_phone, the screen identifier in target for open_screen, and the option/custom payload in value for reply_option/custom.`
const schemaRepairInstruction = `Schema repair: obey every required JSON field exactly. ${actionContract}`

function extractContent(payload: GroqChatResponse): string {
  const content = payload.choices?.[0]?.message?.content
  if (typeof content === 'string' && content.trim()) return content.trim()
  throw new Error('groq_output_missing')
}

export function normalizeGroqText(value: string) {
  return value
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, ' ')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*[-*][ \t]+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function normalizeGroqActions(actions: GroqAction[] | undefined): AiAction[] {
  return (actions ?? []).map(action => {
    const target = action.target?.trim() || null
    const value = action.value?.trim() || null
    return {
      type: action.type,
      label: action.label?.trim() || null,
      url: action.type === 'open_url' || action.type === 'download_file' ? (target ?? value) : null,
      phone: action.type === 'call_phone' ? (target ?? value) : null,
      screen: action.type === 'open_screen' ? (target ?? value) : null,
      value: ['reply_option', 'custom'].includes(action.type) ? (value ?? target) : value,
    }
  })
}

function safeProviderDetail(value: unknown) {
  if (typeof value !== 'string') return ''
  return value.replace(/[\r\n\t]+/g, ' ').replace(/[^\x20-\x7E\u0600-\u06FF]/g, '').trim().slice(0, 280)
}

async function providerError(response: Response) {
  let detail = ''
  try {
    const payload = await response.json() as GroqErrorResponse
    detail = safeProviderDetail(payload.error?.message || payload.error?.code || payload.error?.type)
  } catch {
    // Do not expose arbitrary upstream response bodies.
  }
  return {
    detail,
    message: detail ? `chat_provider_error:${response.status}:${detail}` : `chat_provider_error:${response.status}`,
  }
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
    const run = async (repair = false) => {
      const messages = [
        { role: 'system', content: schema ? `${instructions}\n\n${actionContract}` : instructions },
        ...(repair ? [{ role: 'system', content: schemaRepairInstruction }] : []),
        { role: 'user', content: input },
      ]
      const body: Record<string, unknown> = {
        model: this.chatModel,
        messages,
        max_completion_tokens: maxOutputTokens,
        temperature: repair ? 0 : 0.2,
        reasoning_effort: 'low',
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
      return { response, body }
    }

    let attempt = await run(false)
    if (!attempt.response.ok) {
      const firstError = await providerError(attempt.response)
      const schemaMismatch = Boolean(schema) && attempt.response.status === 400 && firstError.detail.includes('Generated JSON does not match the expected schema')
      if (!schemaMismatch) throw new Error(firstError.message)
      attempt = await run(true)
      if (!attempt.response.ok) throw new Error((await providerError(attempt.response)).message)
    }

    const payload = await attempt.response.json() as GroqChatResponse
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
    const result = await this.completion<{ answer: string; intent: string; requestHuman: boolean; actions: GroqAction[] }>(
      schema,
      'central_ai_response',
      input.instructions,
      input.userInput,
      input.maxOutputTokens,
    )
    return {
      ...result.value,
      answer: normalizeGroqText(result.value.answer),
      actions: normalizeGroqActions(result.value.actions),
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    }
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
    const result = await this.completion<{ answer: string; intent: string; requestHuman: boolean; actions: GroqAction[]; toolCode: string | null; toolInputJson: string | null }>(
      schema,
      'central_ai_tool_plan',
      input.instructions,
      input.userInput,
      input.maxOutputTokens,
    )
    return {
      ...result.value,
      answer: normalizeGroqText(result.value.answer),
      actions: normalizeGroqActions(result.value.actions),
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    }
  }

  async text(instructions: string, input: string, maxOutputTokens = 500): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
    const result = await this.completion<string>(null, 'central_ai_text', instructions, input, maxOutputTokens)
    return { text: normalizeGroqText(result.value), inputTokens: result.inputTokens, outputTokens: result.outputTokens }
  }
}

export function createGroqProvider(settings: { chat_model: string; embedding_model: string }, secret?: string | null) {
  const key = secret?.trim() || Deno.env.get('GROQ_API_KEY')?.trim() || ''
  if (!key) throw new Error('groq_api_key_missing')
  if (key.length < 20 || key.length > 512) throw new Error('groq_api_key_invalid')
  return new GroqProvider(key, settings.chat_model, settings.embedding_model)
}
