create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
do $$ begin if not exists(select 1 from vault.secrets where name='background_worker_token') then perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'background_worker_token','Central AI background worker authentication token'); end if; end $$;
create or replace function public.get_background_worker_token() returns text language sql security definer set search_path='' as $$ select decrypted_secret from vault.decrypted_secrets where name='background_worker_token' limit 1 $$;
revoke all on function public.get_background_worker_token() from public,anon,authenticated; grant execute on function public.get_background_worker_token() to service_role;
-- Cron calls need project-specific URL/publishable key in Vault. Configure them with scripts/configure-cron.sql after linking the project.
