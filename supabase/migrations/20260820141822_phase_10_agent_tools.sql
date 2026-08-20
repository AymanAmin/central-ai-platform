create table public.agent_tools(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, name text not null, code text not null, description text,
 method text not null check(method in('GET','POST')), endpoint_url text not null, auth_type text, auth_config_encrypted text, request_schema jsonb not null default '{}'::jsonb,
 response_schema jsonb not null default '{}'::jsonb, is_read_only boolean not null default true, requires_verification boolean not null default true, requires_human_approval boolean not null default false,
 timeout_seconds integer not null default 10 check(timeout_seconds between 1 and 60), is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organization_id,code), unique(id,organization_id)
);
create table public.tool_executions(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, conversation_id uuid not null, message_id uuid, tool_id uuid not null,
 input_json jsonb not null default '{}'::jsonb, output_json jsonb, status text not null check(status in('pending','running','completed','failed','denied')), http_status integer,duration_ms integer,error_message text,created_at timestamptz not null default now(),
 foreign key(conversation_id,organization_id) references public.conversations(id,organization_id) on delete cascade,
 foreign key(message_id,organization_id) references public.messages(id,organization_id) on delete set null,
 foreign key(tool_id,organization_id) references public.agent_tools(id,organization_id) on delete restrict
);
create trigger agent_tools_set_updated_at before update on public.agent_tools for each row execute function public.set_updated_at();
create index agent_tools_org_idx on public.agent_tools(organization_id,is_active);
create index tool_executions_conversation_org_fk_idx on public.tool_executions(conversation_id,organization_id);
create index tool_executions_message_org_fk_idx on public.tool_executions(message_id,organization_id);
create index tool_executions_tool_org_fk_idx on public.tool_executions(tool_id,organization_id);
create index tool_executions_org_idx on public.tool_executions(organization_id,created_at desc);
alter table public.agent_tools enable row level security; alter table public.tool_executions enable row level security;
create policy agent_tools_select on public.agent_tools for select to authenticated using(app_private.is_super_admin() or organization_id=app_private.current_user_organization_id());
create policy tool_executions_select on public.tool_executions for select to authenticated using(app_private.is_super_admin() or organization_id=app_private.current_user_organization_id());
create view public.agent_tools_safe with(security_invoker=true) as select id,organization_id,name,code,description,method,endpoint_url,auth_type,request_schema,response_schema,is_read_only,requires_verification,requires_human_approval,timeout_seconds,is_active,created_at,updated_at from public.agent_tools;
revoke all on public.agent_tools from anon,authenticated; grant select on public.agent_tools_safe to authenticated; grant select on public.tool_executions to authenticated; grant all on public.agent_tools,public.tool_executions to service_role;
