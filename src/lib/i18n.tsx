import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react'

export type AppLanguage = 'ar' | 'en'

type I18nValue = {
  language: AppLanguage
  dir: 'rtl' | 'ltr'
  locale: 'ar-SA' | 'en-US'
  setLanguage: (language: AppLanguage) => void
  toggleLanguage: () => void
  tr: (ar: string, en: string) => string
  formatDate: (value: string | number | Date) => string
  valueLabel: (value: string | null | undefined) => string
}

const I18nContext = createContext<I18nValue | null>(null)
const storageKey = 'central-ai-language'

const labels: Record<string, { ar: string; en: string }> = {
  SUPER_ADMIN: { ar: 'مدير عام', en: 'Super Admin' },
  ORGANIZATION_ADMIN: { ar: 'مدير جهة', en: 'Organization Admin' },
  KNOWLEDGE_MANAGER: { ar: 'مدير المعرفة', en: 'Knowledge Manager' },
  SUPPORT_AGENT: { ar: 'موظف دعم', en: 'Support Agent' },
  VIEWER: { ar: 'مشاهد', en: 'Viewer' },

  active: { ar: 'نشط', en: 'Active' },
  inactive: { ar: 'متوقف', en: 'Inactive' },
  enabled: { ar: 'مفعّل', en: 'Enabled' },
  disabled: { ar: 'معطّل', en: 'Disabled' },
  open: { ar: 'مفتوحة', en: 'Open' },
  closed: { ar: 'مغلقة', en: 'Closed' },
  archived: { ar: 'مؤرشفة', en: 'Archived' },
  waiting: { ar: 'بانتظار موظف', en: 'Waiting' },
  waiting_customer: { ar: 'بانتظار العميل', en: 'Waiting for customer' },
  waiting_human: { ar: 'بانتظار موظف', en: 'Waiting for human' },
  waiting_for_human: { ar: 'بانتظار موظف', en: 'Waiting for human' },
  human_assigned: { ar: 'مُسندة لموظف', en: 'Human assigned' },
  assigned: { ar: 'مُسندة', en: 'Assigned' },
  resolved: { ar: 'تم الحل', en: 'Resolved' },
  completed: { ar: 'مكتملة', en: 'Completed' },
  pending: { ar: 'قيد الانتظار', en: 'Pending' },
  processing: { ar: 'قيد المعالجة', en: 'Processing' },
  ready: { ar: 'جاهز', en: 'Ready' },
  failed: { ar: 'فشل', en: 'Failed' },

  ar: { ar: 'العربية', en: 'Arabic' },
  en: { ar: 'الإنجليزية', en: 'English' },
  manual_text: { ar: 'نص يدوي', en: 'Manual text' },
  file: { ar: 'ملف', en: 'File' },
  faq: { ar: 'سؤال شائع', en: 'FAQ' },
  url: { ar: 'رابط ويب', en: 'Web URL' },
  api: { ar: 'واجهة API', en: 'API' },

  system: { ar: 'النظام', en: 'System' },
  user: { ar: 'المستخدم', en: 'User' },
  assistant: { ar: 'المساعد', en: 'Assistant' },
  tool: { ar: 'أداة', en: 'Tool' },
  inbound: { ar: 'واردة', en: 'Inbound' },
  outbound: { ar: 'صادرة', en: 'Outbound' },
  internal: { ar: 'داخلية', en: 'Internal' },

  none: { ar: 'بدون مصادقة', en: 'No authentication' },
  bearer: { ar: 'رمز Bearer', en: 'Bearer token' },
  api_key: { ar: 'مفتاح API', en: 'API key' },

  whatsapp: { ar: 'واتساب', en: 'WhatsApp' },
  website: { ar: 'موقع إلكتروني', en: 'Website' },
  web: { ar: 'ويب', en: 'Web' },
  mobile: { ar: 'تطبيق جوال', en: 'Mobile app' },
  crm: { ar: 'نظام CRM', en: 'CRM' },
  admission: { ar: 'القبول', en: 'Admission' },
  erp: { ar: 'نظام ERP', en: 'ERP' },

  greeting: { ar: 'تحية', en: 'Greeting' },
  general_question: { ar: 'سؤال عام', en: 'General question' },
  fees: { ar: 'الرسوم', en: 'Fees' },
  payment: { ar: 'الدفع', en: 'Payment' },
  application_status: { ar: 'حالة الطلب', en: 'Application status' },
  appointment: { ar: 'موعد', en: 'Appointment' },
  complaint: { ar: 'شكوى', en: 'Complaint' },
  human_support: { ar: 'دعم بشري', en: 'Human support' },
  unknown: { ar: 'غير معروف', en: 'Unknown' },

  customer_requested: { ar: 'طلب العميل', en: 'Customer requested' },
  low_confidence: { ar: 'ثقة منخفضة', en: 'Low confidence' },
  payment_issue: { ar: 'مشكلة دفع', en: 'Payment issue' },
  sensitive_request: { ar: 'طلب حساس', en: 'Sensitive request' },
  tool_failed: { ar: 'فشل الأداة', en: 'Tool failed' },
  manual: { ar: 'تحويل يدوي', en: 'Manual handoff' },
  policy: { ar: 'سياسة الجهة', en: 'Policy' },
  handoff: { ar: 'تحويل بشري', en: 'Human handoff' },

  chat: { ar: 'محادثة ذكاء اصطناعي', en: 'AI chat' },
  embedding: { ar: 'تضمين متجهي', en: 'Embedding' },
  document_embedding: { ar: 'تضمين مستند', en: 'Document embedding' },
  conversation_summary: { ar: 'تلخيص محادثة', en: 'Conversation summary' },
  faq_direct: { ar: 'إجابة مباشرة من الأسئلة الشائعة', en: 'Direct FAQ answer' },

  create_organization: { ar: 'إنشاء جهة', en: 'Create organization' },
  invite_user: { ar: 'دعوة مستخدم', en: 'Invite user' },
  create_api_client: { ar: 'إنشاء عميل API', en: 'Create API client' },
  rotate_api_key: { ar: 'تدوير مفتاح API', en: 'Rotate API key' },
  create_agent_tool: { ar: 'إنشاء أداة وكيل', en: 'Create agent tool' },
  set_ai_provider_secret: { ar: 'تحديث مفتاح مزود الذكاء الاصطناعي', en: 'Update AI provider key' },
  update_ai_settings: { ar: 'تحديث إعدادات الذكاء الاصطناعي', en: 'Update AI settings' },
  upload_document: { ar: 'رفع مستند', en: 'Upload document' },
  delete_document: { ar: 'حذف مستند', en: 'Delete document' },
  edit_faq: { ar: 'تعديل سؤال شائع', en: 'Edit FAQ' },
  edit_prompt: { ar: 'تعديل توجيه', en: 'Edit prompt' },
  human_takeover: { ar: 'استلام بشري للمحادثة', en: 'Human takeover' },
  resume_ai: { ar: 'استئناف الذكاء الاصطناعي', en: 'Resume AI' },

  organization: { ar: 'جهة', en: 'Organization' },
  profile: { ar: 'مستخدم', en: 'User profile' },
  api_client: { ar: 'عميل API', en: 'API client' },
  knowledge_document: { ar: 'مستند معرفة', en: 'Knowledge document' },
  knowledge_base: { ar: 'قاعدة معرفة', en: 'Knowledge base' },
  prompt_profile: { ar: 'ملف توجيه', en: 'Prompt profile' },
  agent_tool: { ar: 'أداة وكيل', en: 'Agent tool' },
  conversation: { ar: 'محادثة', en: 'Conversation' },

  forbidden: { ar: 'غير مصرح لك بتنفيذ هذا الإجراء.', en: 'You are not authorized to perform this action.' },
  unauthorized: { ar: 'يجب تسجيل الدخول أولًا.', en: 'You must sign in first.' },
  organization_required: { ar: 'يجب تحديد الجهة.', en: 'Organization is required.' },
  organization_forbidden: { ar: 'لا يمكنك الوصول إلى هذه الجهة.', en: 'You cannot access this organization.' },
  bootstrap_closed: { ar: 'تم إغلاق التهيئة الأولية لأن مديرًا عامًا موجود بالفعل.', en: 'Bootstrap is closed because a Super Admin already exists.' },
  url_private_host_blocked: { ar: 'تم رفض الرابط لأنه يشير إلى مضيف داخلي أو محلي.', en: 'The URL was blocked because it points to a private or local host.' },
  url_private_address_blocked: { ar: 'تم رفض الرابط لأنه يحل إلى عنوان شبكة خاص أو محجوز.', en: 'The URL was blocked because it resolves to a private or reserved address.' },
  url_fetch_timeout: { ar: 'انتهت مهلة جلب الصفحة.', en: 'The page fetch timed out.' },
  url_content_too_large: { ar: 'حجم الصفحة أكبر من الحد المسموح 2MB.', en: 'The page exceeds the 2MB limit.' },
  url_unsupported_content_type: { ar: 'نوع محتوى الرابط غير مدعوم. استخدم صفحة HTML أو نصًا عاديًا.', en: 'Unsupported URL content type. Use an HTML or plain-text page.' },
  url_no_extractable_text: { ar: 'لم يتم العثور على نص قابل للاستخراج في الصفحة.', en: 'No extractable text was found on the page.' },
  url_dns_resolution_failed: { ar: 'تعذر الوصول إلى اسم النطاق.', en: 'The domain name could not be resolved.' },
  url_fetch_failed: { ar: 'تعذر جلب الصفحة.', en: 'The page could not be fetched.' },
  'Invalid login credentials': { ar: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.', en: 'Invalid email or password.' },
  'Email not confirmed': { ar: 'يجب تأكيد البريد الإلكتروني أولًا.', en: 'Email must be confirmed first.' },
  'User already registered': { ar: 'هذا البريد مسجل بالفعل.', en: 'This email is already registered.' },
}

function initialLanguage(): AppLanguage {
  const stored = localStorage.getItem(storageKey)
  if (stored === 'ar' || stored === 'en') return stored
  return navigator.language.toLowerCase().startsWith('ar') ? 'ar' : 'en'
}

export function I18nProvider({ children }: PropsWithChildren) {
  const [language, setLanguage] = useState<AppLanguage>(initialLanguage)
  const dir = language === 'ar' ? 'rtl' : 'ltr'
  const locale = language === 'ar' ? 'ar-SA' : 'en-US'

  useEffect(() => {
    localStorage.setItem(storageKey, language)
    document.documentElement.lang = language
    document.documentElement.dir = dir
    document.body.dir = dir
  }, [language, dir])

  const value = useMemo<I18nValue>(() => ({
    language,
    dir,
    locale,
    setLanguage,
    toggleLanguage: () => setLanguage(current => current === 'ar' ? 'en' : 'ar'),
    tr: (ar, en) => language === 'ar' ? ar : en,
    formatDate: value => new Date(value).toLocaleString(locale),
    valueLabel: value => {
      if (!value) return '—'
      const normalized = value.trim()
      const known = labels[normalized] ?? labels[normalized.toLowerCase()]
      return known ? known[language] : normalized
    },
  }), [language, dir, locale])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useI18n must be used inside I18nProvider')
  return value
}
