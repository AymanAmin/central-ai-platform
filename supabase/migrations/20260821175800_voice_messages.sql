alter table public.organization_agents
  add column if not exists voice_enabled boolean not null default false,
  add column if not exists voice_provider text not null default 'gemini',
  add column if not exists voice_model text not null default 'gemini-2.5-flash-lite',
  add column if not exists max_voice_seconds integer not null default 120,
  add column if not exists included_monthly_voice_minutes integer;

alter table public.organization_agents
  drop constraint if exists organization_agents_voice_provider_check,
  add constraint organization_agents_voice_provider_check check (voice_provider in ('gemini','openai','groq')),
  drop constraint if exists organization_agents_voice_model_check,
  add constraint organization_agents_voice_model_check check (char_length(voice_model) between 2 and 180),
  drop constraint if exists organization_agents_max_voice_seconds_check,
  add constraint organization_agents_max_voice_seconds_check check (max_voice_seconds between 10 and 600),
  drop constraint if exists organization_agents_included_voice_minutes_check,
  add constraint organization_agents_included_voice_minutes_check check (included_monthly_voice_minutes is null or included_monthly_voice_minutes >= 0);

alter table public.model_pricing
  add column if not exists audio_cost_per_minute numeric not null default 0 check (audio_cost_per_minute >= 0);

create table if not exists public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  kind text not null default 'audio' check (kind in ('audio')),
  bucket text not null default 'chat-media',
  storage_path text not null unique,
  mime_type text not null,
  byte_size integer not null check (byte_size > 0 and byte_size <= 8388608),
  duration_ms integer check (duration_ms is null or (duration_ms > 0 and duration_ms <= 600000)),
  transcript text,
  transcription_provider text,
  transcription_model text,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  estimated_cost numeric not null default 0 check (estimated_cost >= 0),
  created_at timestamptz not null default now()
);

create index if not exists message_attachments_message_idx on public.message_attachments(message_id);
create index if not exists message_attachments_org_created_idx on public.message_attachments(organization_id, created_at desc);

alter table public.message_attachments enable row level security;

drop policy if exists message_attachments_select on public.message_attachments;
create policy message_attachments_select on public.message_attachments
for select to authenticated
using (app_private.is_super_admin() or organization_id = app_private.current_user_organization_id());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-media',
  'chat-media',
  false,
  8388608,
  array['audio/webm','audio/ogg','audio/wav','audio/x-wav','audio/mpeg','audio/mp3','audio/aac','audio/flac','audio/mp4']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists chat_media_storage_select on storage.objects;
create policy chat_media_storage_select on storage.objects
for select to authenticated
using (
  bucket_id = 'chat-media'
  and (
    app_private.is_super_admin()
    or (storage.foldername(name))[1] = app_private.current_user_organization_id()::text
  )
);

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
  where kind = 'audio' and created_at >= date_trunc('month', now())
  group by organization_id
)
select
  o.id as organization_id,
  coalesce(m.customer_messages, 0) as customer_messages,
  coalesce(u.total_tokens, 0) as total_tokens,
  coalesce(u.estimated_cost_usd, 0) as estimated_cost_usd,
  coalesce(v.voice_duration_ms, 0) as voice_duration_ms
from public.organizations o
left join usage_month u on u.organization_id = o.id
left join message_month m on m.organization_id = o.id
left join voice_month v on v.organization_id = o.id;

grant select on public.organization_agent_monthly_usage to authenticated;
