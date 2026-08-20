create table public.api_rate_limit_windows(
 api_client_id uuid not null references public.api_clients(id) on delete cascade, window_started_at timestamptz not null, request_count integer not null default 0 check(request_count>=0),
 primary key(api_client_id,window_started_at)
);
alter table public.api_rate_limit_windows enable row level security;
create policy api_rate_limit_windows_admin_select on public.api_rate_limit_windows for select to authenticated using(app_private.is_super_admin() or exists(select 1 from public.api_clients c where c.id=api_client_id and c.organization_id=app_private.current_user_organization_id()));
create or replace function public.consume_api_rate_limit(p_api_client_id uuid,p_limit integer) returns boolean language plpgsql security definer set search_path='' as $$
declare v_window timestamptz:=date_trunc('minute',now()); v_count integer;
begin if p_limit<=0 then return false; end if; insert into public.api_rate_limit_windows(api_client_id,window_started_at,request_count) values(p_api_client_id,v_window,1)
on conflict(api_client_id,window_started_at) do update set request_count=public.api_rate_limit_windows.request_count+1 returning request_count into v_count; return v_count<=p_limit; end;
$$;
revoke all on function public.consume_api_rate_limit(uuid,integer) from public,anon,authenticated;
grant execute on function public.consume_api_rate_limit(uuid,integer) to service_role;
grant select on public.api_rate_limit_windows to authenticated;
grant all on public.api_rate_limit_windows to service_role;
