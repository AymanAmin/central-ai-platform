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
  open: { ar: 'مفتوحة', en: 'Open' },
  closed: { ar: 'مغلقة', en: 'Closed' },
  waiting: { ar: 'بانتظار موظف', en: 'Waiting' },
  assigned: { ar: 'مُسندة', en: 'Assigned' },
  resolved: { ar: 'تم الحل', en: 'Resolved' },
  pending: { ar: 'قيد الانتظار', en: 'Pending' },
  processing: { ar: 'قيد المعالجة', en: 'Processing' },
  ready: { ar: 'جاهز', en: 'Ready' },
  failed: { ar: 'فشل', en: 'Failed' },
  ar: { ar: 'العربية', en: 'Arabic' },
  en: { ar: 'الإنجليزية', en: 'English' },
  manual_text: { ar: 'نص يدوي', en: 'Manual text' },
  file: { ar: 'ملف', en: 'File' },
  url: { ar: 'رابط ويب', en: 'Web URL' },
  system: { ar: 'النظام', en: 'System' },
  user: { ar: 'المستخدم', en: 'User' },
  assistant: { ar: 'المساعد', en: 'Assistant' },
  none: { ar: 'بدون مصادقة', en: 'No authentication' },
  bearer: { ar: 'رمز Bearer', en: 'Bearer token' },
  api_key: { ar: 'مفتاح API', en: 'API key' },
  handoff: { ar: 'تحويل بشري', en: 'Human handoff' },
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
      const known = labels[value]
      return known ? known[language] : value
    },
  }), [language, dir, locale])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useI18n must be used inside I18nProvider')
  return value
}
