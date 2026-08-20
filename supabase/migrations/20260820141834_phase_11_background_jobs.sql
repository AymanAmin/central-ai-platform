create table public.background_jobs(
 id uuid primary key default gen_random_uuid(), organization_id uuid references public.organizations(id) on delete cascade, job_type text not null, payload jsonb not null default '{}'::jsonb,
 status text not null default 'pending' check(status in('pending','running','completed','failed','cancelled')), priority integer not null default 100, attempts integer not null default 0 check(attempts>=0),
 max_attempts integer not null default 3 check(max_attempts>0), next_run_at timestamptz not null default now(), started_at timestamptz, completed_at timestamptz, last_error text, created_at timestamptz not null default now()
);
create index background_jobs_worker_idx on public.background_jobs(status,next_run_at,priority desc,created_at);
create index background_jobs_org_idx on public.background_jobs(organization_id,created_at desc);
alter table public.background_jobs enable row level security;
create policy background_jobs_select on public.background_jobs for select to authenticated using(app_private.is_super_admin() or organization_id=app_private.current_user_organization_id());
grant select on public.background_jobs to authenticated; grant all on public.background_jobs to service_role;
