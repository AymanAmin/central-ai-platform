import type { AiChatResult, AiProvider, AiToolPlanResult, EmbeddingResult, EmbeddingTask } from './ai.ts'
import { optimizeRuntimePrompt, PromptBudgetProvider } from './prompt-budget.ts'

const assertEquals = (actual: unknown, expected: unknown) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}
const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message) }

const appointmentTool = '- GET_APPONITMENT: تستخدم هذه الأداة عندما يسأل العميل عن موعد محجوز مسبقًا أو يريد معرفة تاريخ أو وقت موعده الحالي أو القادم; method=GET; parameters=mob رقم الملف او رقم الجوال'
const instructions = `System prompt\n\nSecurity rules:\n- Do not invent facts.\n\nAvailable read-only tools:\n${appointmentTool}`
const input = (current: string, recent = '(none)', knowledge = '[Source 1 | similarity=0.9]\n' + 'معلومات الجامعة '.repeat(400)) => `Customer profile:\n{"name":"Ayman"}\n\nConversation summary:\n(none)\n\nRecent messages:\n${recent}\n\nRetrieved knowledge:\n${knowledge}\n\nCurrent customer message:\n${current}`

Deno.test('Prompt Budget Engine excludes unrelated appointment tool from medicine question', () => {
  const optimized = optimizeRuntimePrompt('groq', 'openai/gpt-oss-20b', instructions, input('بستفسر عن الطب البشري'), true)
  assertEquals(optimized.useTools, false)
  assertEquals(optimized.stats.toolsBefore, 1)
  assertEquals(optimized.stats.toolsAfter, 0)
  assert(optimized.instructions.endsWith('Available read-only tools:\n(none)'), 'unrelated tools should be removed from prompt')
  assert(optimized.stats.inputAfterChars < optimized.stats.inputBeforeChars, 'large RAG context should be compacted')
})

Deno.test('Prompt Budget Engine keeps appointment tool for a direct appointment request', () => {
  const optimized = optimizeRuntimePrompt('groq', 'openai/gpt-oss-20b', instructions, input('احتاج استعلم عن موعدي'), true)
  assertEquals(optimized.useTools, true)
  assertEquals(optimized.stats.toolsAfter, 1)
  assert(optimized.instructions.includes('GET_APPONITMENT'), 'appointment tool should remain available')
})

Deno.test('Prompt Budget Engine keeps tool for short parameter continuation', () => {
  const recent = 'user: احتاج استعلم عن موعدي\nassistant: لإكمال طلبك أحتاج رقم الملف او رقم الجوال'
  const optimized = optimizeRuntimePrompt('groq', 'openai/gpt-oss-20b', instructions, input('966550932548', recent), true)
  assertEquals(optimized.useTools, true)
  assertEquals(optimized.stats.toolsAfter, 1)
})

Deno.test('Prompt Budget Engine gives Groq a tighter RAG budget than Gemini', () => {
  const longInput = input('اعطني تفاصيل عن برنامج الطب البشري')
  const groq = optimizeRuntimePrompt('groq', 'openai/gpt-oss-20b', instructions, longInput, false)
  const gemini = optimizeRuntimePrompt('gemini', 'gemini-3.1-flash-lite', instructions, longInput, false)
  assert(groq.stats.inputAfterChars < gemini.stats.inputAfterChars, 'Groq budget should be tighter than Gemini')
})

class StubProvider implements AiProvider {
  readonly provider = 'groq'
  readonly chatModel = 'openai/gpt-oss-20b'
  readonly embeddingModel = 'gemini-embedding-001'
  chatCalls = 0
  toolCalls = 0

  async embedding(_texts: string[], _task?: EmbeddingTask): Promise<EmbeddingResult> { return { vectors: [[1]], tokens: 1 } }
  async chat(_input: { instructions: string; userInput: string; maxOutputTokens: number }): Promise<AiChatResult> {
    this.chatCalls += 1
    return { answer: 'ok', intent: 'general_question', requestHuman: false, actions: [], inputTokens: 10, outputTokens: 3 }
  }
  async chatWithTools(_input: { instructions: string; userInput: string; maxOutputTokens: number }): Promise<AiToolPlanResult> {
    this.toolCalls += 1
    return { answer: 'tool', intent: 'appointment', requestHuman: false, actions: [], toolCode: 'GET_APPONITMENT', toolInputJson: '{}', inputTokens: 12, outputTokens: 4 }
  }
  async text(_instructions: string, value: string): Promise<{ text: string; inputTokens: number; outputTokens: number }> { return { text: value, inputTokens: 1, outputTokens: 1 } }
}

Deno.test('PromptBudgetProvider downgrades unrelated tool plan to normal chat', async () => {
  const inner = new StubProvider()
  const provider = new PromptBudgetProvider(inner)
  const result = await provider.chatWithTools({ instructions, userInput: input('بستفسر عن الطب البشري'), maxOutputTokens: 200 })
  assertEquals(inner.chatCalls, 1)
  assertEquals(inner.toolCalls, 0)
  assertEquals(result.toolCode, null)
  assertEquals(result.toolInputJson, null)
})
