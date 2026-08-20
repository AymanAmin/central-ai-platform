create table public.handoff_requests(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, conversation_id uuid not null,
 reason text not null check(reason in('customer_requested','low_confidence','complaint','payment_issue','sensitive_request','tool_failed','manual','policy')),
 requested_by text not null, status text not null default 'waiting' check(status in('waiting','assigned','resolved','cancelled')), assigned_user_id uuid references public.profiles(id) on delete set null,
 requested_at timestamptz not null default now(), assigned_at timestamptz, resolved_at timestamptz, notes text,
 foreign key(conversation_id,organization_id) references public.conversations(id,organization_id) on delete cascade
);
create index handoff_requests_conversation_org_fk_idx on public.handoff_requests(conversation_id,organization_id);
create index handoff_requests_assigned_user_idx on public.handoff_requests(assigned_user_id);
create index handoff_requests_queue_idx on public.handoff_requests(organization_id,status,requested_at);
alter table public.handoff_requests enable row level security;
create policy handoff_requests_select on public.handoff_requests for select to authenticated using(app_private.is_super_admin() or organization_id=app_private.current_user_organization_id());
create policy handoff_requests_update on public.handoff_requests for update to authenticated using(app_private.can_support() and (app_private.is_super_admin() or organization_id=app_private.current_user_organization_id())) with check(app_private.can_support() and (app_private.is_super_admin() or organization_id=app_private.current_user_organization_id()));
grant select,update on public.handoff_requests to authenticated; grant all on public.handoff_requests to service_role;
