import { useI18n } from '../lib/i18n'

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { language, toggleLanguage, tr } = useI18n()
  return <button type="button" className={`language-switch ${compact ? 'compact' : ''}`} onClick={toggleLanguage} aria-label={tr('تغيير اللغة', 'Change language')}>
    <span aria-hidden="true">🌐</span>
    <span>{language === 'ar' ? 'English' : 'العربية'}</span>
  </button>
}
