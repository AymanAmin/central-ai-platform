insert into public.ai_provider_settings (
  organization_id,
  provider,
  chat_model,
  embedding_model,
  is_active,
  is_default,
  max_output_tokens,
  temperature
)
select
  null,
  'groq',
  'openai/gpt-oss-20b',
  'gemini-embedding-001',
  true,
  false,
  600,
  0.2
where not exists (
  select 1
  from public.ai_provider_settings
  where organization_id is null
    and provider = 'groq'
);

insert into public.model_pricing (
  provider,
  model,
  input_cost_per_million,
  output_cost_per_million,
  embedding_cost_per_million,
  effective_from,
  is_active
)
values
  ('groq', 'openai/gpt-oss-20b', 0.075, 0.30, 0, date '2026-08-22', true),
  ('groq', 'openai/gpt-oss-120b', 0.15, 0.60, 0, date '2026-08-22', true)
on conflict (provider, model, effective_from) do update
set
  input_cost_per_million = excluded.input_cost_per_million,
  output_cost_per_million = excluded.output_cost_per_million,
  embedding_cost_per_million = excluded.embedding_cost_per_million,
  is_active = excluded.is_active;
