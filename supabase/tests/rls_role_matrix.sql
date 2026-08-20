begin;

create temporary table test_rls_ids(
  key text primary key,
  user_id uuid,
  organization_id uuid
) on commit drop;
grant select on test_rls_ids to authenticated;

insert into test_rls_ids(key,user_id,organization_id) values
  ('org_a_admin',gen_random_uuid(),gen_random_uuid()),
  ('org_b_viewer',gen_random_uuid(),gen_random_uuid()),
  ('super_admin',gen_random_uuid(),null);

insert into public.organizations(id,code,name_ar)
select organization_id,'RLS_'||upper(left(key,8))||'_'||substr(organization_id::text,1,8),key
from test_rls_ids where organization_id is not null;

insert into public.organization_settings(organization_id)
select organization_id from test_rls_ids where organization_id is not null;

insert into auth.users(id,email)
select user_id,key||'-'||substr(user_id::text,1,8)||'@test.invalid' from test_rls_ids;

insert into public.profiles(id,organization_id,full_name,email,role,is_active)
select user_id,organization_id,key,key||'@test.invalid',
  case key when 'org_a_admin' then 'ORGANIZATION_ADMIN' when 'org_b_viewer' then 'VIEWER' else 'SUPER_ADMIN' end,
  true
from test_rls_ids;

set local role authenticated;
select set_config('request.jwt.claim.sub',(select user_id::text from test_rls_ids where key='org_a_admin'),true);

do $$
declare
  org_a uuid := (select organization_id from test_rls_ids where key='org_a_admin');
  org_b uuid := (select organization_id from test_rls_ids where key='org_b_viewer');
  visible_count integer;
  foreign_count integer;
  changed integer;
begin
  select count(*) into visible_count from public.organizations where id in (org_a,org_b);
  if visible_count <> 1 then raise exception 'FAILED: org A admin should see exactly one test organization, got %', visible_count; end if;

  select count(*) into foreign_count from public.organizations where id=org_b;
  if foreign_count <> 0 then raise exception 'FAILED: org A admin can read org B'; end if;

  select count(*) into foreign_count from public.profiles where organization_id=org_b;
  if foreign_count <> 0 then raise exception 'FAILED: org A admin can read org B profiles'; end if;

  update public.organizations set name_en='should-not-change' where id=org_b;
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'FAILED: org A admin updated org B'; end if;
end $$;

select set_config('request.jwt.claim.sub',(select user_id::text from test_rls_ids where key='org_b_viewer'),true);

do $$
declare
  org_a uuid := (select organization_id from test_rls_ids where key='org_a_admin');
  org_b uuid := (select organization_id from test_rls_ids where key='org_b_viewer');
  visible_count integer;
  changed integer;
begin
  select count(*) into visible_count from public.organizations where id in (org_a,org_b);
  if visible_count <> 1 then raise exception 'FAILED: org B viewer should see exactly one test organization, got %', visible_count; end if;

  update public.organizations set name_en='viewer-should-not-update' where id=org_b;
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'FAILED: viewer updated own organization'; end if;
end $$;

select set_config('request.jwt.claim.sub',(select user_id::text from test_rls_ids where key='super_admin'),true);

do $$
declare
  org_a uuid := (select organization_id from test_rls_ids where key='org_a_admin');
  org_b uuid := (select organization_id from test_rls_ids where key='org_b_viewer');
  visible_count integer;
  changed integer;
begin
  select count(*) into visible_count from public.organizations where id in (org_a,org_b);
  if visible_count <> 2 then raise exception 'FAILED: super admin cannot read both organizations, got %', visible_count; end if;

  update public.organizations set name_en='super-admin-tested' where id in (org_a,org_b);
  get diagnostics changed = row_count;
  if changed <> 2 then raise exception 'FAILED: super admin should update both organizations, changed %', changed; end if;
end $$;

rollback;
