create unique index if not exists background_jobs_process_document_active_uq on public.background_jobs(job_type,(payload->>'documentId')) where job_type='process_document' and status in('pending','running');
create schema if not exists private; revoke all on schema private from public,anon,authenticated;
create or replace function private.enqueue_knowledge_document_job() returns trigger language plpgsql security definer set search_path='' as $$
begin if new.processing_status='pending' and (tg_op='INSERT' or old.processing_status is distinct from new.processing_status) then
 insert into public.background_jobs(organization_id,job_type,payload,status,priority) values(new.organization_id,'process_document',jsonb_build_object('documentId',new.id),'pending',50) on conflict do nothing;
 end if; return new; end;
$$;
revoke all on function private.enqueue_knowledge_document_job() from public,anon,authenticated;
create trigger trg_knowledge_document_enqueue after insert or update of processing_status on public.knowledge_documents for each row execute function private.enqueue_knowledge_document_job();
