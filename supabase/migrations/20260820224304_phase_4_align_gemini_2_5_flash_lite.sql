update public.ai_provider_settings
set chat_model = 'gemini-2.5-flash-lite', updated_at = now()
where provider = 'gemini'
  and organization_id is null
  and is_default = true;
