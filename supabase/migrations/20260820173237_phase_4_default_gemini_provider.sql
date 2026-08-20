update public.ai_provider_settings
set provider = 'gemini',
    chat_model = 'gemini-2.5-flash-lite',
    embedding_model = 'gemini-embedding-001',
    updated_at = now()
where organization_id is null
  and is_default = true;

insert into public.model_pricing (
  provider, model, input_cost_per_million, output_cost_per_million,
  embedding_cost_per_million, effective_from, is_active
)
values
  ('gemini', 'gemini-2.5-flash-lite', 0.10, 0.40, 0, date '2026-08-20', true),
  ('gemini', 'gemini-embedding-001', 0, 0, 0.15, date '2026-08-20', true)
on conflict (provider, model, effective_from)
do update set
  input_cost_per_million = excluded.input_cost_per_million,
  output_cost_per_million = excluded.output_cost_per_million,
  embedding_cost_per_million = excluded.embedding_cost_per_million,
  is_active = excluded.is_active;
