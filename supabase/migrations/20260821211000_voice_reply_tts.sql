alter table public.organization_agents
  add column if not exists voice_reply_mode text not null default 'text_only',
  add column if not exists tts_provider text not null default 'gemini',
  add column if not exists tts_model text not null default 'gemini-2.5-flash-preview-tts',
  add column if not exists tts_voice_ar text not null default 'Sulafat',
  add column if not exists tts_voice_en text not null default 'Achird',
  add column if not exists included_monthly_tts_minutes integer;

alter table public.organization_agents
  drop constraint if exists organization_agents_voice_reply_mode_check,
  add constraint organization_agents_voice_reply_mode_check
    check (voice_reply_mode in ('text_only','voice_on_voice','always_voice')),
  drop constraint if exists organization_agents_tts_provider_check,
  add constraint organization_agents_tts_provider_check
    check (tts_provider in ('gemini')),
  drop constraint if exists organization_agents_tts_model_check,
  add constraint organization_agents_tts_model_check
    check (char_length(tts_model) between 2 and 180),
  drop constraint if exists organization_agents_tts_voice_ar_check,
  add constraint organization_agents_tts_voice_ar_check
    check (char_length(tts_voice_ar) between 2 and 80),
  drop constraint if exists organization_agents_tts_voice_en_check,
  add constraint organization_agents_tts_voice_en_check
    check (char_length(tts_voice_en) between 2 and 80),
  drop constraint if exists organization_agents_included_tts_minutes_check,
  add constraint organization_agents_included_tts_minutes_check
    check (included_monthly_tts_minutes is null or included_monthly_tts_minutes >= 0);

alter table public.message_attachments
  drop constraint if exists message_attachments_kind_check,
  add constraint message_attachments_kind_check check (kind in ('audio','tts')),
  add column if not exists generation_provider text,
  add column if not exists generation_model text,
  add column if not exists voice_name text,
  add column if not exists language text;

alter table public.message_attachments
  drop constraint if exists message_attachments_language_check,
  add constraint message_attachments_language_check
    check (language is null or language in ('ar','en'));

create unique index if not exists message_attachments_tts_message_unique
  on public.message_attachments(message_id)
  where kind = 'tts';

insert into public.model_pricing (
  provider, model, input_cost_per_million, output_cost_per_million,
  embedding_cost_per_million, audio_cost_per_minute, effective_from, is_active
)
values ('gemini','gemini-2.5-flash-preview-tts',0.50,10.00,0,0,date '2026-08-21',true)
on conflict (provider, model, effective_from) do update set
  input_cost_per_million = excluded.input_cost_per_million,
  output_cost_per_million = excluded.output_cost_per_million,
  is_active = true;

create or replace view public.organization_agent_monthly_usage
with (security_invoker = true)
as
with usage_month as (
  select
    organization_id,
    coalesce(sum(input_tokens + output_tokens + embedding_tokens), 0)::bigint as total_tokens,
    coalesce(sum(estimated_cost), 0)::numeric as estimated_cost_usd
  from public.usage_logs
  where created_at >= date_trunc('month', now())
  group by organization_id
), message_month as (
  select organization_id, count(*)::bigint as customer_messages
  from public.messages
  where role = 'user' and created_at >= date_trunc('month', now())
  group by organization_id
), voice_month as (
  select organization_id, coalesce(sum(duration_ms), 0)::bigint as voice_duration_ms
  from public.message_attachments
  where kind = 'audio' and created_at >= date_trunc('month', now())
  group by organization_id
), tts_month as (
  select organization_id, coalesce(sum(duration_ms), 0)::bigint as tts_duration_ms
  from public.message_attachments
  where kind = 'tts' and created_at >= date_trunc('month', now())
  group by organization_id
)
select
  o.id as organization_id,
  coalesce(m.customer_messages, 0) as customer_messages,
  coalesce(u.total_tokens, 0) as total_tokens,
  coalesce(u.estimated_cost_usd, 0) as estimated_cost_usd,
  coalesce(v.voice_duration_ms, 0) as voice_duration_ms,
  coalesce(t.tts_duration_ms, 0) as tts_duration_ms
from public.organizations o
left join usage_month u on u.organization_id = o.id
left join message_month m on m.organization_id = o.id
left join voice_month v on v.organization_id = o.id
left join tts_month t on t.organization_id = o.id;

grant select on public.organization_agent_monthly_usage to authenticated;

comment on column public.organization_agents.voice_reply_mode is
  'Controls whether AI replies stay text-only, mirror voice input, or always include generated speech.';
comment on column public.organization_agents.tts_voice_ar is
  'Gemini prebuilt voice used for Arabic replies; synthesis prompt enforces a professional Saudi Arabic delivery.';
comment on column public.organization_agents.tts_voice_en is
  'Gemini prebuilt voice used for English replies with a natural English delivery.';
