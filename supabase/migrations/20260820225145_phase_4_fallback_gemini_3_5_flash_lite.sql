-- Gemini 2.5 Flash-Lite is listed by the API, but this project's Google API key
-- receives HTTP 404: "no longer available to new users" for generateContent.
-- Google explicitly directs new users to Gemini 3.5 Flash-Lite, which is GA.
update public.ai_provider_settings
set chat_model = 'gemini-3.5-flash-lite', updated_at = now()
where provider = 'gemini'
  and organization_id is null
  and is_default = true;
