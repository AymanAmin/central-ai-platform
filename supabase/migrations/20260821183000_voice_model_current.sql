alter table public.organization_agents
  alter column voice_model set default 'gemini-3.5-flash-lite';

update public.organization_agents
set voice_model = 'gemini-3.5-flash-lite'
where voice_provider = 'gemini'
  and voice_model in ('gemini-2.5-flash-lite', 'models/gemini-2.5-flash-lite');
