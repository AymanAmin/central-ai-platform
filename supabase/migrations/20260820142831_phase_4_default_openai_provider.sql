insert into public.ai_provider_settings(organization_id,provider,chat_model,embedding_model,is_active,is_default,max_output_tokens,temperature)
select null,'openai','gpt-5.4-nano','text-embedding-3-small',true,true,600,.2
where not exists(select 1 from public.ai_provider_settings where organization_id is null and is_default=true);
insert into public.model_pricing(provider,model,input_cost_per_million,output_cost_per_million,embedding_cost_per_million,effective_from,is_active)
values ('openai','gpt-5.4-nano',.20,1.25,0,'2026-08-20',true),('openai','text-embedding-3-small',0,0,.02,'2026-08-20',true)
on conflict(provider,model,effective_from) do nothing;
