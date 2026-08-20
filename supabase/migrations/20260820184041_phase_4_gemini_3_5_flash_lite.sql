update public.ai_provider_settings
set chat_model = 'gemini-3.5-flash-lite',
    updated_at = now()
where provider = 'gemini'
  and chat_model = 'gemini-2.5-flash-lite';

insert into public.model_pricing (
  provider, model, input_cost_per_million, output_cost_per_million,
  embedding_cost_per_million, effective_from, is_active
)
values
  ('gemini', 'gemini-3.5-flash-lite', 0.30, 2.50, 0, date '2026-08-20', true)
on conflict (provider, model, effective_from)
do update set
  input_cost_per_million = excluded.input_cost_per_million,
  output_cost_per_million = excluded.output_cost_per_million,
  embedding_cost_per_million = excluded.embedding_cost_per_million,
  is_active = excluded.is_active;
