import type { AiChatResult, AiProvider, AiToolPlanResult, EmbeddingResult, EmbeddingTask } from './ai.ts'
import { createGroqProvider } from './groq.ts'
import { groqAgentFallbackModels } from './groq-models.ts'

const isSchemaMismatch = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  return message.startsWith('chat_provider_error:400:') && message.includes('Generated JSON does not match the expected schema')
}

export class ResilientGroqProvider implements AiProvider {
  readonly provider = 'groq'
  private inner: AiProvider

  constructor(
    private settings: { chat_model: string; embedding_model: string },
    private secret?: string | null,
  ) {
    this.inner = createGroqProvider(settings, secret)
  }

  get chatModel() { return this.inner.chatModel }
  get embeddingModel() { return this.inner.embeddingModel }

  embedding(texts: string[], task?: EmbeddingTask): Promise<EmbeddingResult> {
    return this.inner.embedding(texts, task)
  }

  private async withSchemaModelFailover<T>(run: (provider: AiProvider) => Promise<T>): Promise<T> {
    try {
      return await run(this.inner)
    } catch (firstError) {
      if (!isSchemaMismatch(firstError)) throw firstError

      const failedModel = this.inner.chatModel
      let lastError: unknown = firstError
      for (const model of groqAgentFallbackModels(failedModel)) {
        if (model === failedModel) continue
        console.warn('groq_schema_mismatch_trying_next_free_model', { fromModel: failedModel, toModel: model })
        const candidateSettings = { chat_model: model, embedding_model: this.settings.embedding_model }
        const candidate = createGroqProvider(candidateSettings, this.secret)
        try {
          const result = await run(candidate)
          this.inner = candidate
          this.settings.chat_model = candidate.chatModel
          return result
        } catch (error) {
          lastError = error
          if (!isSchemaMismatch(error)) throw error
        }
      }
      throw lastError
    }
  }

  chat(input: { instructions: string; userInput: string; maxOutputTokens: number }): Promise<AiChatResult> {
    return this.withSchemaModelFailover(provider => provider.chat(input))
  }

  chatWithTools(input: { instructions: string; userInput: string; maxOutputTokens: number }): Promise<AiToolPlanResult> {
    return this.withSchemaModelFailover(provider => provider.chatWithTools(input))
  }

  text(instructions: string, input: string, maxOutputTokens?: number): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
    return this.inner.text(instructions, input, maxOutputTokens)
  }
}

export const createResilientGroqProvider = (
  settings: { chat_model: string; embedding_model: string },
  secret?: string | null,
) => new ResilientGroqProvider(settings, secret)
