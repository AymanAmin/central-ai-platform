import type { AiChatResult, AiProvider, AiToolPlanResult, EmbeddingResult, EmbeddingTask } from './ai.ts'

type PromptBudgetProfile = {
  customerProfileChars: number
  summaryChars: number
  recentChars: number
  knowledgeChars: number
  currentMessageChars: number
  toolsChars: number
  genericInputChars: number
}

type PromptOptimization = {
  instructions: string
  userInput: string
  useTools: boolean
  stats: {
    instructionsBeforeChars: number
    instructionsAfterChars: number
    inputBeforeChars: number
    inputAfterChars: number
    estimatedTokensBefore: number
    estimatedTokensAfter: number
    toolsBefore: number
    toolsAfter: number
  }
}

const profiles: Record<string, PromptBudgetProfile> = {
  groq: {
    customerProfileChars: 360,
    summaryChars: 600,
    recentChars: 650,
    knowledgeChars: 1800,
    currentMessageChars: 1200,
    toolsChars: 700,
    genericInputChars: 6500,
  },
  gemini: {
    customerProfileChars: 600,
    summaryChars: 1000,
    recentChars: 1400,
    knowledgeChars: 4200,
    currentMessageChars: 1800,
    toolsChars: 1400,
    genericInputChars: 10_000,
  },
  openai: {
    customerProfileChars: 600,
    summaryChars: 1000,
    recentChars: 1400,
    knowledgeChars: 4200,
    currentMessageChars: 1800,
    toolsChars: 1400,
    genericInputChars: 10_000,
  },
  azure_openai: {
    customerProfileChars: 600,
    summaryChars: 1000,
    recentChars: 1400,
    knowledgeChars: 4200,
    currentMessageChars: 1800,
    toolsChars: 1400,
    genericInputChars: 10_000,
  },
  openrouter: {
    customerProfileChars: 500,
    summaryChars: 900,
    recentChars: 1200,
    knowledgeChars: 3500,
    currentMessageChars: 1600,
    toolsChars: 1200,
    genericInputChars: 8500,
  },
  cloudflare: {
    customerProfileChars: 450,
    summaryChars: 800,
    recentChars: 1000,
    knowledgeChars: 3000,
    currentMessageChars: 1400,
    toolsChars: 1000,
    genericInputChars: 7500,
  },
}

const defaultProfile: PromptBudgetProfile = {
  customerProfileChars: 550,
  summaryChars: 900,
  recentChars: 1200,
  knowledgeChars: 3600,
  currentMessageChars: 1600,
  toolsChars: 1200,
  genericInputChars: 8500,
}

const runtimePattern = /^Customer profile:\n([\s\S]*?)\n\nConversation summary:\n([\s\S]*?)\n\nRecent messages:\n([\s\S]*?)\n\nRetrieved knowledge:\n([\s\S]*?)\n\nCurrent customer message:\n([\s\S]*)$/
const toolsMarker = 'Available read-only tools:\n'

const compactHeadTail = (value: string, maxChars: number) => {
  const clean = value.trim()
  if (clean.length <= maxChars) return clean
  if (maxChars < 24) return clean.slice(0, maxChars)
  const head = Math.ceil(maxChars * .68)
  const tail = Math.max(1, maxChars - head - 3)
  return `${clean.slice(0, head)}...${clean.slice(-tail)}`
}

const compactTail = (value: string, maxChars: number) => {
  const clean = value.trim()
  if (clean.length <= maxChars) return clean
  return maxChars <= 3 ? clean.slice(-maxChars) : `...${clean.slice(-(maxChars - 3))}`
}

const compactKnowledge = (value: string, maxChars: number) => {
  const clean = value.trim()
  if (clean.length <= maxChars) return clean
  const sources = clean.split(/(?=\[Source \d+ \|)/g).filter(Boolean)
  if (sources.length <= 1) return compactHeadTail(clean, maxChars)
  const selected = sources.slice(0, Math.min(3, sources.length))
  const separators = Math.max(0, selected.length - 1) * 2
  const perSource = Math.max(120, Math.floor((maxChars - separators) / selected.length))
  return selected.map(source => compactHeadTail(source, perSource)).join('\n\n').slice(0, maxChars)
}

const complexityMultiplier = (message: string) => {
  const normalized = message.toLowerCase()
  if (message.length > 320 || /(?:قارن|مقارنة|بالتفصيل|تفاصيل كاملة|حلل|compare|detailed|analysis)/i.test(normalized)) return 1.15
  if (message.length <= 120 && !/[\n;]/.test(message)) return .85
  return 1
}

const scaled = (value: number, multiplier: number) => Math.max(120, Math.round(value * multiplier))

const normalizeTerms = (value: string) => {
  const normalized = value
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[_/\\|.,:;!?()[\]{}<>"'`~@#$%^&*+=-]+/g, ' ')
  return new Set(normalized.split(/\s+/).filter(term => term.length >= 3))
}

const overlapCount = (left: Set<string>, right: Set<string>) => {
  let count = 0
  for (const term of left) if (right.has(term)) count += 1
  return count
}

const parameterLike = (value: string) => {
  const clean = value.trim()
  if (/^\+?[0-9\s()-]{5,40}$/.test(clean)) return true
  if (/^[A-Za-z0-9_-]{4,32}$/.test(clean) && !/\s/.test(clean)) return true
  return clean.length <= 24 && !/[؟?]/.test(clean) && clean.split(/\s+/).length <= 3
}

function extractRuntimeSections(userInput: string) {
  const match = userInput.match(runtimePattern)
  if (!match) return null
  return {
    profile: match[1] ?? '',
    summary: match[2] ?? '',
    recent: match[3] ?? '',
    knowledge: match[4] ?? '',
    current: match[5] ?? '',
  }
}

function selectRelevantToolLines(toolText: string, currentMessage: string, recent: string) {
  const lines = toolText.split('\n').map(line => line.trim()).filter(line => line.startsWith('- '))
  if (!lines.length) return { lines: [] as string[], before: 0 }
  const currentTerms = normalizeTerms(currentMessage)
  const recentTerms = parameterLike(currentMessage) ? normalizeTerms(compactTail(recent, 900)) : new Set<string>()
  const selected = lines.filter(line => {
    const toolTerms = normalizeTerms(line)
    if (overlapCount(toolTerms, currentTerms) > 0) return true
    return recentTerms.size > 0 && overlapCount(toolTerms, recentTerms) > 0
  })
  return { lines: selected, before: lines.length }
}

function optimizeInstructions(instructions: string, currentMessage: string, recent: string, profile: PromptBudgetProfile, toolMode: boolean) {
  const index = instructions.indexOf(toolsMarker)
  if (index < 0) return { instructions, useTools: toolMode, toolsBefore: 0, toolsAfter: toolMode ? 1 : 0 }
  const prefix = instructions.slice(0, index + toolsMarker.length)
  const rawTools = instructions.slice(index + toolsMarker.length).trim()
  if (!toolMode || rawTools === '(none)') return { instructions: `${prefix}(none)`, useTools: false, toolsBefore: 0, toolsAfter: 0 }

  const relevant = selectRelevantToolLines(rawTools, currentMessage, recent)
  if (!relevant.lines.length) {
    return { instructions: `${prefix}(none)`, useTools: false, toolsBefore: relevant.before, toolsAfter: 0 }
  }
  const compactedTools = compactHeadTail(relevant.lines.join('\n').replace(/[ \t]+/g, ' '), profile.toolsChars)
  return {
    instructions: `${prefix}${compactedTools}`,
    useTools: true,
    toolsBefore: relevant.before,
    toolsAfter: relevant.lines.length,
  }
}

export function estimatePromptTokens(value: string) {
  const arabic = (value.match(/[\u0600-\u06FF]/g) ?? []).length
  const latinDigits = (value.match(/[A-Za-z0-9]/g) ?? []).length
  const nonSpaceOther = (value.match(/[^\sA-Za-z0-9\u0600-\u06FF]/g) ?? []).length
  return Math.max(1, Math.ceil(arabic * .62 + latinDigits * .25 + nonSpaceOther * .4))
}

export function optimizeRuntimePrompt(provider: string, model: string, instructions: string, userInput: string, toolMode: boolean): PromptOptimization {
  const profile = profiles[provider] ?? defaultProfile
  const sections = extractRuntimeSections(userInput)
  const currentMessage = sections?.current ?? userInput.slice(-1600)
  const multiplier = complexityMultiplier(currentMessage)

  let optimizedInput: string
  let recentForTools = ''
  if (sections) {
    recentForTools = sections.recent
    optimizedInput = `Customer profile:\n${compactHeadTail(sections.profile, scaled(profile.customerProfileChars, multiplier))}\n\nConversation summary:\n${compactHeadTail(sections.summary, scaled(profile.summaryChars, multiplier))}\n\nRecent messages:\n${compactTail(sections.recent, scaled(profile.recentChars, multiplier))}\n\nRetrieved knowledge:\n${compactKnowledge(sections.knowledge, scaled(profile.knowledgeChars, multiplier))}\n\nCurrent customer message:\n${compactHeadTail(sections.current, scaled(profile.currentMessageChars, multiplier))}`
  } else {
    optimizedInput = compactHeadTail(userInput, scaled(profile.genericInputChars, multiplier))
  }

  const instructionOptimization = optimizeInstructions(instructions, currentMessage, recentForTools, profile, toolMode)
  const beforeCombined = `${instructions}\n${userInput}`
  const afterCombined = `${instructionOptimization.instructions}\n${optimizedInput}`
  const stats = {
    instructionsBeforeChars: instructions.length,
    instructionsAfterChars: instructionOptimization.instructions.length,
    inputBeforeChars: userInput.length,
    inputAfterChars: optimizedInput.length,
    estimatedTokensBefore: estimatePromptTokens(beforeCombined),
    estimatedTokensAfter: estimatePromptTokens(afterCombined),
    toolsBefore: instructionOptimization.toolsBefore,
    toolsAfter: instructionOptimization.toolsAfter,
  }

  if (stats.instructionsAfterChars !== stats.instructionsBeforeChars || stats.inputAfterChars !== stats.inputBeforeChars || stats.toolsAfter !== stats.toolsBefore) {
    console.info('prompt_budget_applied', { provider, model, ...stats })
  }

  return {
    instructions: instructionOptimization.instructions,
    userInput: optimizedInput,
    useTools: instructionOptimization.useTools,
    stats,
  }
}

export class PromptBudgetProvider implements AiProvider {
  readonly provider: string

  constructor(private inner: AiProvider) {
    this.provider = inner.provider
  }

  get chatModel() { return this.inner.chatModel }
  get embeddingModel() { return this.inner.embeddingModel }

  embedding(texts: string[], task?: EmbeddingTask): Promise<EmbeddingResult> {
    return this.inner.embedding(texts, task)
  }

  async chat(input: { instructions: string; userInput: string; maxOutputTokens: number }): Promise<AiChatResult> {
    const optimized = optimizeRuntimePrompt(this.provider, this.chatModel, input.instructions, input.userInput, false)
    return this.inner.chat({ ...input, instructions: optimized.instructions, userInput: optimized.userInput })
  }

  async chatWithTools(input: { instructions: string; userInput: string; maxOutputTokens: number }): Promise<AiToolPlanResult> {
    const optimized = optimizeRuntimePrompt(this.provider, this.chatModel, input.instructions, input.userInput, true)
    if (!optimized.useTools) {
      const result = await this.inner.chat({ ...input, instructions: optimized.instructions, userInput: optimized.userInput })
      return { ...result, toolCode: null, toolInputJson: null }
    }
    return this.inner.chatWithTools({ ...input, instructions: optimized.instructions, userInput: optimized.userInput })
  }

  text(instructions: string, input: string, maxOutputTokens?: number): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
    return this.inner.text(instructions, input, maxOutputTokens)
  }
}

export const withPromptBudget = (provider: AiProvider) => new PromptBudgetProvider(provider)
