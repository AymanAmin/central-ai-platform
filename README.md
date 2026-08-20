# Central AI Platform

Multi-tenant AI platform built with React, TypeScript, Vite and Supabase.

## Architecture

- React static admin portal
- Supabase PostgreSQL + Auth + Storage + RLS + Edge Functions
- pgvector for knowledge retrieval
- AI providers accessed only from Edge Functions

## Requirements

- Node.js >= 22
- Supabase project

## Setup

```bash
cp .env.example .env
npm install
npm run build
```

Frontend environment variables are limited to the Supabase public URL/key. Never expose `service_role`, AI provider keys, API client secrets, or tool credentials to the browser.

## Supabase Project

Current project ref: `tffgvfovlpurxmkqkwwq`

## Implementation plan

See `CENTRAL_AI_IMPLEMENTATION.md`.
