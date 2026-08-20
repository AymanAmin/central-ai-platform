create table public.customers(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, external_customer_id text not null,
 display_name text, phone text, email text, language text, metadata jsonb not null default '{}'::jsonb, first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,external_customer_id), unique(id,organization_id)
);
create table public.conversations(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 api_client_id uuid, customer_id uuid not null, external_conversation_id text not null, channel text not null,
 status text not null default 'open' check(status in('open','waiting_customer','waiting_human','human_assigned','closed','archived')),
 summary text, summary_updated_at timestamptz, ai_enabled boolean not null default true, human_takeover boolean not null default false,
 assigned_user_id uuid references public.profiles(id) on delete set null, last_message_at timestamptz not null default now(), closed_at timestamptz, metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,external_conversation_id), unique(id,organization_id),
 foreign key(api_client_id,organization_id) references public.api_clients(id,organization_id) on delete set null, foreign key(customer_id,organization_id) references public.customers(id,organization_id) on delete restrict
);
create table public.messages(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, conversation_id uuid not null,
 external_message_id text, role text not null check(role in('user','assistant','system','tool')), direction text not null check(direction in('inbound','outbound','internal')),
 message_type text not null default 'text', content text, content_json jsonb not null default '{}'::jsonb, language text, intent text,
 confidence numeric check(confidence is null or confidence between 0 and 1), requires_human boolean not null default false, provider text, model text,
 input_tokens integer, output_tokens integer, estimated_cost numeric, latency_ms integer, created_at timestamptz not null default now(), unique(id,organization_id),
 foreign key(conversation_id,organization_id) references public.conversations(id,organization_id) on delete cascade
);
create unique index messages_org_external_message_uq on public.messages(organization_id,external_message_id) where external_message_id is not null;
create trigger customers_set_updated_at before update on public.customers for each row execute function public.set_updated_at();
create trigger conversations_set_updated_at before update on public.conversations for each row execute function public.set_updated_at();
create index customers_organization_external_idx on public.customers(organization_id,external_customer_id);
create index conversations_org_external_idx on public.conversations(organization_id,external_conversation_id);
create index conversations_org_customer_status_idx on public.conversations(organization_id,customer_id,status);
create index conversations_last_message_idx on public.conversations(organization_id,last_message_at desc);
create index messages_conversation_created_idx on public.messages(conversation_id,created_at);
create index messages_org_created_idx on public.messages(organization_id,created_at);
alter table public.customers enable row level security; alter table public.conversations enable row level security; alter table public.messages enable row level security;
create policy customers_select on public.customers for select to authenticated using(app_private.is_super_admin() or organization_id=app_private.current_user_organization_id());
create policy conversations_select on public.conversations for select to authenticated using(app_private.is_super_admin() or organization_id=app_private.current_user_organization_id());
create policy conversations_support_update on public.conversations for update to authenticated using(app_private.can_support() and (app_private.is_super_admin() or organization_id=app_private.current_user_organization_id())) with check(app_private.can_support() and (app_private.is_super_admin() or organization_id=app_private.current_user_organization_id()));
create policy messages_select on public.messages for select to authenticated using(app_private.is_super_admin() or organization_id=app_private.current_user_organization_id());
grant select on public.customers,public.conversations,public.messages to authenticated; grant update on public.conversations to authenticated; grant all on public.customers,public.conversations,public.messages to service_role;
