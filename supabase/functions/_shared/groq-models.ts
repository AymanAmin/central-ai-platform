export type GroqModelPurpose = 'chat' | 'agentic' | 'safety' | 'stt' | 'tts'

export interface GroqFreePlanLimit {
  id: string
  name: string
  purpose: GroqModelPurpose
  rpm: number
  rpd: number
  tpm?: number
  tpd?: number
  ash?: number
  asd?: number
  strictStructured: boolean
}

// Source: Groq official Free Plan rate-limit table, verified 2026-08-23.
// These are rolling/windowed rate limits, not monthly credits.
export const GROQ_FREE_PLAN_LIMITS: GroqFreePlanLimit[] = [
  { id: 'groq/compound', name: 'Compound', purpose: 'agentic', rpm: 30, rpd: 250, tpm: 70_000, strictStructured: false },
  { id: 'groq/compound-mini', name: 'Compound Mini', purpose: 'agentic', rpm: 30, rpd: 250, tpm: 70_000, strictStructured: false },
  { id: 'meta-llama/llama-prompt-guard-2-22m', name: 'Llama Prompt Guard 2 22M', purpose: 'safety', rpm: 30, rpd: 14_400, tpm: 15_000, tpd: 500_000, strictStructured: false },
  { id: 'meta-llama/llama-prompt-guard-2-86m', name: 'Llama Prompt Guard 2 86M', purpose: 'safety', rpm: 30, rpd: 14_400, tpm: 15_000, tpd: 500_000, strictStructured: false },
  { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B', purpose: 'chat', rpm: 30, rpd: 1_000, tpm: 8_000, tpd: 200_000, strictStructured: true },
  { id: 'openai/gpt-oss-20b', name: 'GPT-OSS 20B', purpose: 'chat', rpm: 30, rpd: 1_000, tpm: 8_000, tpd: 200_000, strictStructured: true },
  { id: 'openai/gpt-oss-safeguard-20b', name: 'GPT-OSS Safeguard 20B', purpose: 'safety', rpm: 30, rpd: 1_000, tpm: 8_000, tpd: 200_000, strictStructured: false },
  { id: 'qwen/qwen3.6-27b', name: 'Qwen 3.6 27B', purpose: 'chat', rpm: 30, rpd: 1_000, tpm: 8_000, tpd: 200_000, strictStructured: false },
  { id: 'whisper-large-v3', name: 'Whisper Large V3', purpose: 'stt', rpm: 20, rpd: 2_000, ash: 7_200, asd: 28_800, strictStructured: false },
  { id: 'whisper-large-v3-turbo', name: 'Whisper Large V3 Turbo', purpose: 'stt', rpm: 20, rpd: 2_000, ash: 7_200, asd: 28_800, strictStructured: false },
  { id: 'canopylabs/orpheus-arabic-saudi', name: 'Orpheus Arabic Saudi', purpose: 'tts', rpm: 10, rpd: 100, tpm: 1_200, tpd: 3_600, strictStructured: false },
  { id: 'canopylabs/orpheus-v1-english', name: 'Orpheus English', purpose: 'tts', rpm: 10, rpd: 100, tpm: 1_200, tpd: 3_600, strictStructured: false },
]

export const GROQ_FREE_PLAN_BY_ID = new Map(GROQ_FREE_PLAN_LIMITS.map(model => [model.id, model]))
export const GROQ_AGENT_STRICT_MODEL_IDS = GROQ_FREE_PLAN_LIMITS.filter(model => model.purpose === 'chat' && model.strictStructured).map(model => model.id)
export const GROQ_AGENT_STRICT_MODELS = new Set(GROQ_AGENT_STRICT_MODEL_IDS)

export function groqAgentFallbackModels(currentModel: string) {
  if (!GROQ_AGENT_STRICT_MODELS.has(currentModel)) return [currentModel]
  return [currentModel, ...GROQ_AGENT_STRICT_MODEL_IDS.filter(model => model !== currentModel)]
}
