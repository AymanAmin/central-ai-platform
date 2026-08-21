alter table public.organization_agents
  add column if not exists voice_reply_mode text not null default 'text_only',
  add column if not exists voice_tts_provider text not null default 'gemini',
  add column if not exists voice_tts_model text not null default 'gemini-3.1-flash-tts-preview',
  add column if not exists voice_tts_voice text not null default 'Sulafat',
  add column if not exists included_monthly_tts_minutes integer;

alter table public.organization_agents
  drop constraint if exists organization_agents_voice_reply_mode_check,
  add constraint organization_agents_voice_reply_mode_check
    check (voice_reply_mode in ('text_only','voice_for_voice','always_voice')),
  drop constraint if exists organization_agents_voice_tts_provider_check,
  add constraint organization_agents_voice_tts_provider_check
    check (voice_tts_provider in ('gemini')),
  drop constraint if exists organization_agents_voice_tts_model_check,
  add constraint organization_agents_voice_tts_model_check
    check (char_length(voice_tts_model) between 2 and 180),
  drop constraint if exists organization_agents_voice_tts_voice_check,
  add constraint organization_agents_voice_tts_voice_check
    check (char_length(voice_tts_voice) between 2 and 80),
  drop constraint if exists organization_agents_included_tts_minutes_check,
  add constraint organization_agents_included_tts_minutes_check
    check (included_monthly_tts_minutes is null or included_monthly_tts_minutes >= 0);

alter table public.message_attachments
  add column if not exists audio_source text not null default 'customer_voice',
  add column if not exists generation_provider text,
  add column if not exists generation_model text,
  add column if not exists generation_voice text;

alter table public.message_attachments
  drop constraint if exists message_attachments_audio_source_check,
  add constraint message_attachments_audio_source_check
    check (audio_source in ('customer_voice','assistant_tts')),
  drop constraint if exists message_attachments_generation_consistency_check,
  add constraint message_attachments_generation_consistency_check check (
    audio_source <> 'assistant_tts'
    or (
      original_audio_stored
      and storage_path is not null
      and bucket is not null
      and generation_provider is not null
      and generation_model is not null
      and generation_voice is not null
    )
  );

create index if not exists message_attachments_org_source_created_idx
  on public.message_attachments(organization_id, audio_source, created_at desc);

insert into public.model_pricing (
  provider, model, input_cost_per_million, output_cost_per_million,
  embedding_cost_per_million, audio_cost_per_minute, effective_from, is_active
)
values ('gemini','gemini-3.1-flash-tts-preview',1,20,0,0,current_date,true)
on conflict (provider, model, effective_from) do update set
  input_cost_per_million = excluded.input_cost_per_million,
  output_cost_per_million = excluded.output_cost_per_million,
  is_active = true;

drop view if exists public.organization_agent_monthly_usage;
create view public.organization_agent_monthly_usage
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
  where kind = 'audio'
    and audio_source = 'customer_voice'
    and created_at >= date_trunc('month', now())
  group by organization_id
), tts_month as (
  select organization_id, coalesce(sum(duration_ms), 0)::bigint as tts_duration_ms
  from public.message_attachments
  where kind = 'audio'
    and audio_source = 'assistant_tts'
    and created_at >= date_trunc('month', now())
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
  'Controls whether replies stay text-only, mirror customer voice messages, or always include generated speech.';
comment on column public.organization_agents.voice_tts_voice is
  'Gemini prebuilt voice used for generated replies. Arabic delivery is prompted as Saudi Arabic; English uses natural neutral delivery.';
