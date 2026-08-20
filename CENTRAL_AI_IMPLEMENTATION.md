# Central AI Platform — Implementation Status

This file tracks implementation against the approved Central AI Platform plan. The architecture remains intentionally small: React + TypeScript + Vite for the admin portal, and Supabase PostgreSQL/Auth/Storage/RLS/Edge Functions/pgvector for the backend. No separate Node/.NET backend, Redis, RabbitMQ, Kafka, external vector database, or microservice layer is part of the MVP.

## Current Supabase project

- Project name: `Central AI Platform`
- Project ref: `tffgvfovlpurxmkqkwwq`
- Region: `ap-northeast-1`
- Frontend uses only the Supabase URL and publishable key.
- Provider and tool credentials are server-side only.

## Phase status

### Phase 0 — Bootstrap

- [x] React + TypeScript + Vite repository structure
- [x] Node.js >= 22 requirement
- [x] Supabase project structure
- [x] `.env.example` with public frontend variables only
- [x] CI workflow for typecheck/build
- [x] Implementation tracking document
- [ ] Local/CI build must be confirmed after dependency installation succeeds

### Phase 1 — Auth and Organizations

- [x] Supabase Auth email/password flow
- [x] Password reset/update flow
- [x] `organizations`, `profiles`, `organization_settings`
- [x] Roles: `SUPER_ADMIN`, `ORGANIZATION_ADMIN`, `KNOWLEDGE_MANAGER`, `SUPPORT_AGENT`, `VIEWER`
- [x] Tenant-aware RLS policies
- [x] Safe one-time first `SUPER_ADMIN` bootstrap
- [x] Server-side user invitation flow

### Phase 2 — API Clients

- [x] `api_clients` table
- [x] `ai_live_*` API key generation
- [x] Plain API key shown once only
- [x] SHA-256 hash stored instead of the secret
- [x] Key rotation / enable-disable
- [x] Capabilities, optional IP allow-list and rate limit
- [x] Safe view that excludes the API key hash

### Phase 3 — Customers, Conversations and Chat Core

- [x] Customers, conversations and messages schema
- [x] Multi-tenant composite foreign keys
- [x] Unified `/functions/v1/chat` endpoint
- [x] API client authentication
- [x] Idempotency by external message id
- [x] Database-backed per-minute rate limiting
- [x] Human takeover prevents AI execution

### Phase 4 — AI Provider and Usage

- [x] Provider abstraction in Edge Functions
- [x] OpenAI implementation
- [x] Default cost-first chat model configuration
- [x] `text-embedding-3-small` embedding configuration
- [x] Model pricing and usage logging tables
- [x] Estimated cost tracking
- [ ] `OPENAI_API_KEY` must be configured in Supabase Edge Function Secrets before live model calls work

### Phase 5 — Conversation Memory

- [x] Recent-message memory
- [x] `conversation_summaries`
- [x] Summary threshold configuration
- [x] Summary jobs are queued instead of summarizing every message
- [x] Background worker summary implementation

### Phase 6 — Knowledge Base

- [x] Knowledge bases, documents and FAQ schema
- [x] Private Supabase Storage bucket
- [x] PDF / DOCX / TXT / manual-text processing path
- [x] PDF text extraction without OCR
- [x] File-size and type restrictions
- [x] SHA-256 checksum deduplication
- [x] Document processing status/error tracking

### Phase 7 — Embeddings and RAG

- [x] pgvector enabled
- [x] 1536-dimension embeddings
- [x] Chunking with overlap
- [x] HNSW cosine index
- [x] Tenant-isolated `match_knowledge_chunks` RPC
- [x] Configurable Top-K and minimum similarity
- [x] Retrieval context capped before model input
- [x] Prompt-injection rule: retrieved content is data, not system instructions

### Phase 8 — Cost Optimization

- [x] Greeting fast path without AI
- [x] Direct exact FAQ fast path without AI
- [x] Usage/token/cost logging
- [x] Message/token quota fields and enforcement path
- [x] Normal message target remains one embedding + one chat call
- [x] Additional chat call occurs only when a live tool was actually required

### Phase 9 — Human Handoff

- [x] `handoff_requests`
- [x] Configurable confidence threshold
- [x] Explicit customer handoff request
- [x] Low-confidence handoff
- [x] Tool-failure handoff
- [x] Human takeover / resume-AI controls

### Phase 10 — Agent Tools

- [x] Fixed HTTP GET/POST tool definitions
- [x] Read-only tools enforced for MVP
- [x] Model selects only a predefined tool code; it cannot supply arbitrary URLs
- [x] Tool credentials stored in Supabase Vault
- [x] Bearer and API-key-header auth support
- [x] Verification/capability gates
- [x] Timeout, response-size limit and execution logging
- [x] Basic SSRF protections for localhost/private IP literals and unsafe URL forms
- [x] Tool failure routes to human handoff

### Phase 11 — Background Jobs

- [x] `background_jobs`
- [x] Retry/backoff fields
- [x] Document-processing jobs
- [x] Conversation-summary jobs
- [x] Cleanup job
- [x] Supabase Cron + `pg_net` worker invocation
- [x] Worker token stored in Supabase Vault
- [x] Worker invocation verified with HTTP 200

### Phase 12 — Admin Portal Completion

- [x] Dashboard foundations
- [x] Organizations
- [x] Users/invitations
- [x] API Clients
- [x] Integration guide
- [x] Knowledge management
- [x] Customers and conversations
- [x] Handoff queue
- [x] AI settings / prompts
- [x] Agent tools
- [x] Usage and audit views
- [x] AI Playground diagnostic endpoint/UI
- [ ] Full UX polish, field validation, permission-aware navigation and setup wizard still need refinement

### Phase 13 — Security Hardening

- [x] RLS enabled on exposed tenant tables
- [x] Composite tenant foreign keys
- [x] Service secrets excluded from React
- [x] API key hash hidden from frontend
- [x] Agent tool secrets in Vault
- [x] Private knowledge storage
- [x] Prompt-injection guidance in model instructions
- [x] Security Advisor currently reports no security lints
- [x] Transactional database invariants test cross-tenant FK, idempotency, rate limit and vector isolation
- [ ] Additional adversarial HTTP/SSRF and role-matrix tests should be expanded before production

### Phase 14 — Production Readiness

- [x] GitHub Actions build/typecheck workflow added
- [x] Supabase migration history represented in the repository
- [x] Edge Function sources represented in the repository
- [ ] Configure `OPENAI_API_KEY`
- [ ] Confirm clean dependency install and production build in CI
- [ ] Configure production SMTP for Supabase Auth
- [ ] Configure final frontend hosting/deployment
- [ ] Run end-to-end tests with real Organizations/API Clients/knowledge data
- [ ] Review quotas, model pricing and operational alerts before launch

## Edge Functions

- `admin-api` — authenticated admin-only operations such as user invites, API keys, tool creation and Vault secret updates.
- `chat` — server-to-server Central AI API using `ai_live_*` custom authentication.
- `knowledge-process` — document parsing/chunking/embedding worker entry point.
- `background-worker` — scheduled job executor.
- `playground` — authenticated diagnostic RAG/AI testing without creating a normal conversation.

## Security notes

Never commit or expose `OPENAI_API_KEY`, Supabase secret/service-role keys, generated `ai_live_*` API keys, background-worker tokens, or Agent Tool credentials. The browser receives only the Supabase URL and publishable key. RLS remains the final database authorization boundary for authenticated portal access.

## Next production checkpoint

The next hard gate is to configure the AI provider secret, run the CI build successfully, bootstrap the first Super Admin, create a test Organization/API Client, and execute an end-to-end chat + knowledge + handoff test before production deployment.
