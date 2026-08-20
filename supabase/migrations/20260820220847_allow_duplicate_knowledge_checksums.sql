drop index if exists public.knowledge_documents_checksum_unique;

create index if not exists knowledge_documents_checksum_idx
  on public.knowledge_documents (organization_id, knowledge_base_id, checksum)
  where checksum is not null;
