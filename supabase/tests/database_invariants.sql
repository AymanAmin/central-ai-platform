begin;

do $$
declare
  org_a uuid:=gen_random_uuid(); org_b uuid:=gen_random_uuid(); client_a uuid:=gen_random_uuid(); client_b uuid:=gen_random_uuid(); customer_a uuid:=gen_random_uuid();
  conv_a uuid:=gen_random_uuid(); kb_a uuid:=gen_random_uuid(); kb_b uuid:=gen_random_uuid(); doc_a uuid:=gen_random_uuid(); doc_b uuid:=gen_random_uuid();
  allowed boolean; matches_b integer;
begin
  insert into public.organizations(id,code,name_ar) values(org_a,'TEST_A_'||substr(org_a::text,1,8),'A'),(org_b,'TEST_B_'||substr(org_b::text,1,8),'B');
  insert into public.organization_settings(organization_id) values(org_a),(org_b);
  insert into public.api_clients(id,organization_id,name,code,api_key_hash,api_key_prefix,rate_limit_per_minute,capabilities)
  values(client_a,org_a,'A','A','hash_a_'||org_a,'ai_live_test_a',2,'["chat"]'),(client_b,org_b,'B','B','hash_b_'||org_b,'ai_live_test_b',2,'["chat"]');
  insert into public.customers(id,organization_id,external_customer_id) values(customer_a,org_a,'customer-a');

  begin
    insert into public.conversations(organization_id,api_client_id,customer_id,external_conversation_id,channel) values(org_a,client_b,customer_a,'bad-cross-tenant','test');
    raise exception 'FAILED: cross-tenant API client FK was accepted';
  exception when foreign_key_violation then null; end;

  insert into public.conversations(id,organization_id,api_client_id,customer_id,external_conversation_id,channel) values(conv_a,org_a,client_a,customer_a,'conv-a','test');
  insert into public.messages(organization_id,conversation_id,external_message_id,role,direction,content) values(org_a,conv_a,'same-message','user','inbound','one');
  begin
    insert into public.messages(organization_id,conversation_id,external_message_id,role,direction,content) values(org_a,conv_a,'same-message','user','inbound','duplicate');
    raise exception 'FAILED: duplicate external_message_id was accepted';
  exception when unique_violation then null; end;

  allowed:=public.consume_api_rate_limit(client_a,2); if allowed is not true then raise exception 'FAILED: rate request 1'; end if;
  allowed:=public.consume_api_rate_limit(client_a,2); if allowed is not true then raise exception 'FAILED: rate request 2'; end if;
  allowed:=public.consume_api_rate_limit(client_a,2); if allowed is not false then raise exception 'FAILED: rate request 3 should be blocked'; end if;

  insert into public.knowledge_bases(id,organization_id,name,code) values(kb_a,org_a,'A','A'),(kb_b,org_b,'B','B');
  insert into public.knowledge_documents(id,organization_id,knowledge_base_id,title,source_type,processing_status) values(doc_a,org_a,kb_a,'A','manual_text','ready'),(doc_b,org_b,kb_b,'B','manual_text','ready');
  insert into public.knowledge_chunks(organization_id,knowledge_base_id,document_id,chunk_index,content,embedding,embedding_model)
  values(org_a,kb_a,doc_a,0,'tenant a',('[1,0,0' || repeat(',0',1533) || ']')::extensions.vector,'test'),
        (org_b,kb_b,doc_b,0,'tenant b',('[1,0,0' || repeat(',0',1533) || ']')::extensions.vector,'test');

  select count(*) into matches_b from public.match_knowledge_chunks(org_a,('[1,0,0'||repeat(',0',1533)||']')::extensions.vector,10,0,null) where document_id=doc_b;
  if matches_b<>0 then raise exception 'FAILED: vector search leaked tenant B'; end if;
end $$;

rollback;
