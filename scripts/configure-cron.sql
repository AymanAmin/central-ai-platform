-- Run after replacing placeholders. Do NOT commit real secrets here.
-- Project URL and publishable key are safe for client use, but Vault keeps the cron config centralized.
do $$
begin
  if not exists(select 1 from vault.secrets where name='central_ai_project_url') then
    perform vault.create_secret('https://YOUR_PROJECT_REF.supabase.co','central_ai_project_url');
  end if;
  if not exists(select 1 from vault.secrets where name='central_ai_publishable_key') then
    perform vault.create_secret('YOUR_PUBLISHABLE_KEY','central_ai_publishable_key');
  end if;
end $$;

select cron.schedule('central-ai-background-worker','* * * * *',$job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='central_ai_project_url') || '/functions/v1/background-worker',
    headers := jsonb_build_object('Content-Type','application/json','apikey',(select decrypted_secret from vault.decrypted_secrets where name='central_ai_publishable_key'),'x-worker-token',(select decrypted_secret from vault.decrypted_secrets where name='background_worker_token')),
    body := jsonb_build_object('limit',2), timeout_milliseconds := 60000
  );
$job$);
select cron.schedule('central-ai-daily-cleanup-enqueue','15 3 * * *',$job$ insert into public.background_jobs(organization_id,job_type,payload,status,priority,max_attempts) values(null,'cleanup','{}'::jsonb,'pending',10,3); $job$);
