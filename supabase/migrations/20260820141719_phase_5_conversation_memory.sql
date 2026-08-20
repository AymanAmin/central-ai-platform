create table public.conversation_summaries(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, conversation_id uuid not null, summary text not null,
 from_message_id uuid, to_message_id uuid, model text, token_count integer check(token_count is null or token_count>=0), created_at timestamptz not null default now(),
 foreign key(conversation_id,organization_id) references public.conversations(id,organization_id) on delete cascade,
 foreign key(from_message_id,organization_id) references public.messages(id,organization_id) on delete set null,
 foreign key(to_message_id,organization_id) references public.messages(id,organization_id) on delete set null
);
create index conversation_summaries_conversation_org_idx on public.conversation_summaries(conversation_id,organization_id,created_at desc);
create index conversation_summaries_from_message_org_idx on public.conversation_summaries(from_message_id,organization_id);
create index conversation_summaries_to_message_org_idx on public.conversation_summaries(to_message_id,organization_id);
create index conversation_summaries_org_idx on public.conversation_summaries(organization_id);
alter table public.conversation_summaries enable row level security;
create policy conversation_summaries_select on public.conversation_summaries for select to authenticated using(app_private.is_super_admin() or organization_id=app_private.current_user_organization_id());
grant select on public.conversation_summaries to authenticated; grant all on public.conversation_summaries to service_role;
