create table public.knowledge_bases(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, name text not null, code text not null,
 description text, is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,code), unique(id,organization_id)
);
create table public.knowledge_documents(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, knowledge_base_id uuid not null, title text not null,
 source_type text not null check(source_type in('file','faq','manual_text','url','api')), original_file_name text, storage_path text, source_url text, checksum text, language text,
 processing_status text not null default 'pending' check(processing_status in('pending','processing','ready','failed','disabled')), processing_error text, is_active boolean not null default true,
 metadata jsonb not null default '{}'::jsonb, created_by uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), processed_at timestamptz,
 unique(id,knowledge_base_id,organization_id), foreign key(knowledge_base_id,organization_id) references public.knowledge_bases(id,organization_id) on delete cascade
);
create table public.knowledge_chunks(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, knowledge_base_id uuid not null, document_id uuid not null,
 chunk_index integer not null check(chunk_index>=0), content text not null, token_count integer check(token_count is null or token_count>=0), page_number integer, section_title text,
 embedding extensions.vector(1536), embedding_model text, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
 foreign key(document_id,knowledge_base_id,organization_id) references public.knowledge_documents(id,knowledge_base_id,organization_id) on delete cascade
);
create table public.knowledge_faq(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, knowledge_base_id uuid not null,
 question text not null, answer text not null, language text not null default 'ar', priority integer not null default 0, is_active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), foreign key(knowledge_base_id,organization_id) references public.knowledge_bases(id,organization_id) on delete cascade
);
create trigger knowledge_bases_set_updated_at before update on public.knowledge_bases for each row execute function public.set_updated_at();
create trigger knowledge_documents_set_updated_at before update on public.knowledge_documents for each row execute function public.set_updated_at();
create trigger knowledge_faq_set_updated_at before update on public.knowledge_faq for each row execute function public.set_updated_at();
create index knowledge_bases_org_idx on public.knowledge_bases(organization_id);
create index knowledge_documents_org_kb_idx on public.knowledge_documents(organization_id,knowledge_base_id);
create index knowledge_documents_kb_org_fk_idx on public.knowledge_documents(knowledge_base_id,organization_id);
create index knowledge_documents_created_by_idx on public.knowledge_documents(created_by);
create index knowledge_chunks_org_kb_doc_idx on public.knowledge_chunks(organization_id,knowledge_base_id,document_id);
create index knowledge_chunks_document_kb_org_fk_idx on public.knowledge_chunks(document_id,knowledge_base_id,organization_id);
create index knowledge_chunks_embedding_hnsw_idx on public.knowledge_chunks using hnsw(embedding extensions.vector_cosine_ops) where embedding is not null;
create index knowledge_faq_org_kb_idx on public.knowledge_faq(organization_id,knowledge_base_id,priority desc);
create index knowledge_faq_kb_org_fk_idx on public.knowledge_faq(knowledge_base_id,organization_id);
create or replace function public.match_knowledge_chunks(p_organization_id uuid,p_query_embedding extensions.vector,p_match_count integer default 4,p_min_similarity double precision default .60,p_knowledge_base_id uuid default null)
returns table(id uuid,document_id uuid,knowledge_base_id uuid,content text,page_number integer,section_title text,similarity double precision)
language sql stable set search_path='' as $$
 select kc.id,kc.document_id,kc.knowledge_base_id,kc.content,kc.page_number,kc.section_title,1-(kc.embedding operator(extensions.<=>) p_query_embedding) similarity
 from public.knowledge_chunks kc where kc.organization_id=p_organization_id and (p_knowledge_base_id is null or kc.knowledge_base_id=p_knowledge_base_id) and kc.embedding is not null
 and (1-(kc.embedding operator(extensions.<=>) p_query_embedding))>=p_min_similarity order by kc.embedding operator(extensions.<=>) p_query_embedding limit least(greatest(p_match_count,1),20)
$$;
revoke all on function public.match_knowledge_chunks(uuid,extensions.vector,integer,double precision,uuid) from public,anon,authenticated;
grant execute on function public.match_knowledge_chunks(uuid,extensions.vector,integer,double precision,uuid) to service_role;

alter table public.knowledge_bases enable row level security; alter table public.knowledge_documents enable row level security; alter table public.knowledge_chunks enable row level security; alter table public.knowledge_faq enable row level security;
create policy knowledge_bases_select on public.knowledge_bases for select to authenticated using(app_private.is_super_admin() or organization_id=app_private.current_user_organization_id());
create policy knowledge_bases_insert on public.knowledge_bases for insert to authenticated with check(app_private.can_manage_knowledge() and (app_private.is_super_admin() or organization_id=app_private.current_user_organization_id()));
create policy knowledge_bases_update on public.knowledge_bases for update to authenticated using(app_private.can_manage_knowledge() and (app_private.is_super_admin() or organization_id=app_private.current_user_organization_id())) with check(app_private.can_manage_knowledge() and (app_private.is_super_admin() or organization_id=app_private.current_user_organization_id()));
create policy knowledge_bases_delete on public.knowledge_bases for delete to authenticated using(app_private.can_manage_knowledge() and (app_private.is_super_admin() or organization_id=app_private.current_user_organization_id()));
create policy knowledge_documents_select on public.knowledge_documents for select to authenticated using(app_private.is_super_admin() or organization_id=app_private.current_user_organization_id());
create policy knowledge_documents_insert on public.knowledge_documents for insert to authenticated with check(app_private.can_manage_knowledge() and (app_private.is_super_admin() or organization_id=app_private.current_user_organization_id()));
create policy knowledge_documents_update on public.knowledge_documents for update to authenticated using(app_private.can_manage_knowledge() and (app_private.is_super_admin() or organization_id=app_private.current_user_organization_id())) with check(app_private.can_manage_knowledge() and (app_private.is_super_admin() or organization_id=app_private.current_user_organization_id()));
create policy knowledge_documents_delete on public.knowledge_documents for delete to authenticated using(app_private.can_manage_knowledge() and (app_private.is_super_admin() or organization_id=app_private.current_user_organization_id()));
create policy knowledge_chunks_select on public.knowledge_chunks for select to authenticated using(app_private.is_super_admin() or organization_id=app_private.current_user_organization_id());
create policy knowledge_faq_select on public.knowledge_faq for select to authenticated using(app_private.is_super_admin() or organization_id=app_private.current_user_organization_id());
create policy knowledge_faq_insert on public.knowledge_faq for insert to authenticated with check(app_private.can_manage_knowledge() and (app_private.is_super_admin() or organization_id=app_private.current_user_organization_id()));
create policy knowledge_faq_update on public.knowledge_faq for update to authenticated using(app_private.can_manage_knowledge() and (app_private.is_super_admin() or organization_id=app_private.current_user_organization_id())) with check(app_private.can_manage_knowledge() and (app_private.is_super_admin() or organization_id=app_private.current_user_organization_id()));
create policy knowledge_faq_delete on public.knowledge_faq for delete to authenticated using(app_private.can_manage_knowledge() and (app_private.is_super_admin() or organization_id=app_private.current_user_organization_id()));
grant select,insert,update,delete on public.knowledge_bases,public.knowledge_documents,public.knowledge_faq to authenticated; grant select on public.knowledge_chunks to authenticated; grant all on public.knowledge_bases,public.knowledge_documents,public.knowledge_chunks,public.knowledge_faq to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('knowledge','knowledge',false,20971520,array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy knowledge_storage_select on storage.objects for select to authenticated using(bucket_id='knowledge' and (app_private.is_super_admin() or (storage.foldername(name))[1]=app_private.current_user_organization_id()::text));
create policy knowledge_storage_insert on storage.objects for insert to authenticated with check(bucket_id='knowledge' and app_private.can_manage_knowledge() and (app_private.is_super_admin() or (storage.foldername(name))[1]=app_private.current_user_organization_id()::text));
create policy knowledge_storage_update on storage.objects for update to authenticated using(bucket_id='knowledge' and app_private.can_manage_knowledge() and (app_private.is_super_admin() or (storage.foldername(name))[1]=app_private.current_user_organization_id()::text)) with check(bucket_id='knowledge' and app_private.can_manage_knowledge() and (app_private.is_super_admin() or (storage.foldername(name))[1]=app_private.current_user_organization_id()::text));
create policy knowledge_storage_delete on storage.objects for delete to authenticated using(bucket_id='knowledge' and app_private.can_manage_knowledge() and (app_private.is_super_admin() or (storage.foldername(name))[1]=app_private.current_user_organization_id()::text));
