# Central AI Platform — Implementation Status

This file tracks implementation against the approved Central AI Platform plan. The architecture remains intentionally small: React + TypeScript + Vite for the admin portal, and Supabase PostgreSQL/Auth/Storage/RLS/Edge Functions/pgvector for the backend. No separate Node/.NET backend, Redis, RabbitMQ, Kafka, external vector database, or microservice layer is part of the MVP.

## Current Supabase project

- Project name: `Central AI Platform`
- Project ref: `tffgvfovlpurxmkqkwwq`
- Region: `ap-northeast-1`
- Project health: active and healthy.
- Frontend uses only the Supabase URL and publishable key.
- Provider and tool credentials are server-side only and AI provider credentials are stored in Supabase Vault.
- Current operational chat provider: Google Gemini.
- Current operational chat model: `gemini-3.5-flash-lite`.
- Embedding model: `gemini-embedding-001`, requested at 1536 dimensions for the existing pgvector schema.

## Provider compatibility note — Gemini 2.5 Flash-Lite

The project preference is Gemini 2.5 Flash-Lite. On 2026-08-21 the configured Google API key was tested directly against the Gemini API. The key can list `models/gemini-2.5-flash-lite`, but `generateContent` returns HTTP 404 with Google's provider message that Gemini 2.5 Flash-Lite is no longer available to new users and directs the caller to Gemini 3.5 Flash-Lite.

`gemini-3.5-flash-lite` was then tested with the same server-side key and returned HTTP 200. A real background conversation-summary job also completed using `gemini-3.5-flash-lite`, proving the Vault → Edge Function → Gemini → PostgreSQL usage path. The fallback is therefore an external provider compatibility exception rather than a change in the platform architecture. UI chrome uses the generic label `Gemini Flash-Lite` so it does not claim a model version different from the provider configuration.

## Phase status

### Phase 0 — Bootstrap

- [x] React + TypeScript + Vite repository structure
- [x] Node.js >= 22 requirement
- [x] Supabase project structure
- [x] `.env.example` with public frontend variables only
- [x] CI workflow for typecheck/build
- [x] Implementation tracking document
- [x] Clean dependency installation, strict TypeScript check and Vite production build verified in GitHub Actions

### Phase 1 — Auth and Organizations

- [x] Supabase Auth email/password flow
- [x] Password reset/update flow
- [x] `organizations`, `profiles`, `organization_settings`
- [x] Roles: `SUPER_ADMIN`, `ORGANIZATION_ADMIN`, `KNOWLEDGE_MANAGER`, `SUPPORT_AGENT`, `VIEWER`
- [x] Tenant-aware RLS policies
- [x] Safe one-time first `SUPER_ADMIN` bootstrap
- [x] Server-side user invitation flow
- [x] Role-aware frontend navigation prevents users opening pages outside their role matrix

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
- [x] Reusable `scripts/smoke-chat.mjs` validates the external response contract and duplicate-message replay when supplied an `ai_live_*` key at runtime

### Phase 4 — AI Provider and Usage

- [x] Provider abstraction in Edge Functions
- [x] Gemini implementation
- [x] OpenAI implementation retained as an optional provider abstraction
- [x] Server-side provider secret in Supabase Vault
- [x] Current Gemini key/provider connectivity verified live
- [x] `gemini-embedding-001` embedding configuration
- [x] Model pricing and usage logging tables
- [x] Estimated cost tracking
- [x] Live conversation-summary AI call completed and usage logged

### Phase 5 — Conversation Memory

- [x] Recent-message memory
- [x] `conversation_summaries`
- [x] Summary threshold configuration
- [x] Summary jobs are queued instead of summarizing every message
- [x] Background worker summary implementation
- [x] Live summary worker path verified against the configured Gemini provider

### Phase 6 — Knowledge Base

- [x] Knowledge bases, documents and FAQ schema
- [x] Private Supabase Storage bucket
- [x] PDF / DOCX / TXT / manual-text processing path
- [x] Single-URL knowledge source support
- [x] PDF text extraction without OCR
- [x] File-size and type restrictions
- [x] SHA-256 checksum handling
- [x] Document processing status/error tracking
- [x] Current knowledge corpus verified: 16 documents Ready and 78 chunks

### Phase 7 — Embeddings and RAG

- [x] pgvector enabled
- [x] 1536-dimension embeddings
- [x] Chunking with overlap
- [x] HNSW cosine index
- [x] Tenant-isolated `match_knowledge_chunks` RPC
- [x] Configurable Top-K and minimum similarity
- [x] Retrieval context capped before model input
- [x] Prompt-injection rule: retrieved content is data, not system instructions
- [x] Transactional vector-isolation test passes

### Phase 8 — Cost Optimization

- [x] Greeting fast path without AI
- [x] Direct exact FAQ fast path without AI
- [x] Usage/token/cost logging
- [x] Message/token quota fields and enforcement path
- [x] Normal message target remains one embedding + one chat call
- [x] Additional chat call occurs only when a live tool was actually required
- [x] Duplicate message protection verified transactionally

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
- [x] Basic SSRF protections for unsafe URL forms, localhost and private IP literals
- [x] Tool failure routes to human handoff
- [ ] DNS-rebinding / redirect-focused adversarial Agent Tool tests should be completed before enabling untrusted tenant-defined tool endpoints at scale

### Phase 11 — Background Jobs

- [x] `background_jobs`
- [x] Retry/backoff fields
- [x] Document-processing jobs
- [x] Conversation-summary jobs
- [x] Cleanup job
- [x] Supabase Cron + `pg_net` worker invocation
- [x] Worker token stored in Supabase Vault
- [x] Worker invocation verified with HTTP 200
- [x] Real AI-backed summary job verified and its temporary test data removed afterward

### Phase 12 — Admin Portal Completion

- [x] Dashboard
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
- [x] Setup Wizard
- [x] Responsive side navigation for mobile and large screens
- [x] Arabic/English and RTL/LTR handling
- [x] Role-aware navigation and direct-page authorization guard
- [x] Admin UI density/localization refinements applied

### Phase 13 — Security Hardening

- [x] RLS enabled on exposed tenant tables
- [x] Composite tenant foreign keys
- [x] Service secrets excluded from React
- [x] API key hash hidden from frontend
- [x] Agent tool secrets in Vault
- [x] AI provider secret in Vault
- [x] Private knowledge storage
- [x] Prompt-injection guidance in model instructions
- [x] Transactional database invariants test passes: cross-tenant FK, idempotency, rate limit and vector isolation
- [x] Transactional RLS role-matrix test passes for Organization Admin, Viewer and Super Admin
- [x] Security Advisor reviewed; no structural RLS exposure lint is currently reported
- [ ] Supabase Auth leaked-password protection is disabled; Supabase documents this feature as a Pro-plan setting and it cannot be enabled through the current project connector
- [ ] Expand Agent Tool SSRF tests to DNS-rebinding and redirect cases before treating arbitrary third-party tenant endpoints as fully hardened

### Phase 14 — Production Readiness

- [x] GitHub Actions strict typecheck/build workflow
- [x] Supabase migration history represented in the repository
- [x] Edge Function sources represented in the repository
- [x] AI provider secret configured server-side
- [x] Provider connectivity tested live
- [x] Production frontend hosting/deployment workflow configured for GitHub Pages
- [x] Database tenant/idempotency/rate-limit/vector tests executed successfully
- [x] RLS role matrix executed successfully
- [x] Reusable external `/chat` contract/idempotency smoke script added
- [ ] Execute the external `/chat` smoke script with a freshly generated `ai_live_*` key and retain the result as a release check
- [ ] Configure production SMTP for Supabase Auth if branded/reliable production email delivery is required
- [ ] Enable leaked-password protection if the Supabase subscription supports it
- [ ] Run representative load tests after real traffic assumptions (message rate, organizations and knowledge size) are agreed
- [ ] Final review of organization quotas and operational alert thresholds before public launch

## Edge Functions

- `admin-api` — authenticated admin-only operations such as user invites, API keys, tool creation and Vault secret updates.
- `chat` — server-to-server Central AI API using `ai_live_*` custom authentication.
- `knowledge-process` — document/URL parsing, chunking and embedding worker entry point.
- `background-worker` — scheduled document, summary and cleanup job executor.
- `playground` — authenticated diagnostic RAG/AI testing without creating a normal conversation.

## Security notes

Never commit or expose Gemini/OpenAI API keys, Supabase secret/service-role keys, generated `ai_live_*` API keys, background-worker tokens, or Agent Tool credentials. The browser receives only the Supabase URL and publishable key. RLS remains the final database authorization boundary for authenticated portal access; frontend page permissions are an additional UX and defense-in-depth layer, not a replacement for RLS.

## Verification snapshot — 2026-08-21

Completed and verified:

- Strict TypeScript + Vite build passed in GitHub Actions after removing the previous non-blocking typecheck behavior.
- Existing database invariants test executed successfully inside a rollback transaction.
- New role-matrix RLS test executed successfully inside a rollback transaction.
- All five Edge Functions are active in Supabase.
- Knowledge processing is healthy: 16/16 current documents are Ready, with 78 stored chunks.
- Gemini provider secret is configured in Vault.
- Gemini 2.5 Flash-Lite was explicitly tested and rejected by Google for this new API user with HTTP 404.
- Gemini 3.5 Flash-Lite was explicitly tested and returned HTTP 200.
- A real AI-backed conversation summary completed on Gemini 3.5 Flash-Lite and wrote usage data; all temporary smoke-test rows were then removed.

## Implementation Notes

Completed:
- Strict CI gate, RLS role matrix, role-aware navigation, external chat smoke runner, current-provider verification, and provider fallback documentation.

Files Added:
- `src/lib/permissions.ts`
- `scripts/smoke-chat.mjs`
- `supabase/tests/rls_role_matrix.sql`
- `supabase/migrations/20260820224304_phase_4_align_gemini_2_5_flash_lite.sql`
- `supabase/migrations/20260820225145_phase_4_fallback_gemini_3_5_flash_lite.sql`

Files Modified:
- `.github/workflows/ci.yml`
- `package.json`
- `src/app/App.tsx`
- `src/features/dashboard/Dashboard.tsx`
- `src/layouts/AdminLayout.tsx`
- `CENTRAL_AI_IMPLEMENTATION.md`

Database:
- Gemini provider preference was tested, recorded, and operationally returned to the provider-supported Flash-Lite model after live verification.
- No smoke-test customer/conversation/message data remains after verification.

Tests:
- Database invariants: PASS.
- RLS role matrix: PASS.
- GitHub Actions strict typecheck/build: PASS on the production-readiness branch before the final documentation commit; rerun required after final branch updates.
- Gemini 3.5 direct provider request: HTTP 200.
- Background AI summary: PASS.

Known Issues / External Gates:
- Google does not allow this project's new API user to invoke Gemini 2.5 Flash-Lite despite listing it; operational fallback is Gemini 3.5 Flash-Lite.
- External `/chat` smoke still requires a freshly generated show-once API client key at execution time.
- Leaked-password protection and production SMTP are Supabase account/configuration concerns outside repository code.
- Advanced DNS-rebinding/redirect SSRF hardening remains a pre-scale security gate for Agent Tools.

Next:
- Get the final CI run green, merge to `main`, verify GitHub Pages deployment, then execute the external `/chat` smoke with a fresh API client key during release validation.
