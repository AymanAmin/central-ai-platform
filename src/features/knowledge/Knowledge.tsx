import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { Badge, Card, Empty, FieldHint, PageHeader, PanelHeader } from '../../components/Ui'
import type { KnowledgeBase, KnowledgeDocument, Organization, Profile } from '../../types/domain'
import { useI18n, type AppLanguage } from '../../lib/i18n'

export function Knowledge({ profile }: { profile: Profile }) {
  const { language, tr, valueLabel } = useI18n()
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [organizationId, setOrganizationId] = useState(profile.organization_id ?? '')
  const [bases, setBases] = useState<KnowledgeBase[]>([])
  const [docs, setDocs] = useState<KnowledgeDocument[]>([])
  const [kbName, setKbName] = useState('')
  const [kbCode, setKbCode] = useState('')
  const [selectedKb, setSelectedKb] = useState('')
  const [contentLanguage, setContentLanguage] = useState<AppLanguage>(language)
  const [faqQ, setFaqQ] = useState('')
  const [faqA, setFaqA] = useState('')
  const [manualTitle, setManualTitle] = useState('')
  const [manualText, setManualText] = useState('')
  const [urlTitle, setUrlTitle] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [message, setMessage] = useState('')

  const load = async () => {
    const [o, b, d] = await Promise.all([
      supabase.from('organizations').select('*'),
      supabase.from('knowledge_bases').select('*').order('created_at', { ascending: false }),
      supabase.from('knowledge_documents').select('*').order('created_at', { ascending: false }),
    ])
    setOrgs((o.data ?? []) as Organization[])
    setBases((b.data ?? []) as KnowledgeBase[])
    setDocs((d.data ?? []) as KnowledgeDocument[])
  }

  useEffect(() => { void load() }, [])

  const createKb = async (e: FormEvent) => {
    e.preventDefault()
    const { data, error } = await supabase.from('knowledge_bases').insert({
      organization_id: organizationId,
      name: kbName,
      code: kbCode.toUpperCase().replace(/[^A-Z0-9_-]/g, '_'),
    }).select('id').single()
    setMessage(error?.message ?? tr('تم إنشاء قاعدة المعرفة.', 'Knowledge base created.'))
    if (data) {
      setKbName('')
      setKbCode('')
      setSelectedKb(data.id)
      await load()
    }
  }

  const addFaq = async (e: FormEvent) => {
    e.preventDefault()
    const kb = bases.find(x => x.id === selectedKb)
    if (!kb) return
    const { error } = await supabase.from('knowledge_faq').insert({
      organization_id: kb.organization_id,
      knowledge_base_id: kb.id,
      question: faqQ,
      answer: faqA,
      language: contentLanguage,
    })
    setMessage(error?.message ?? tr('تمت إضافة السؤال الشائع.', 'FAQ added.'))
    if (!error) {
      setFaqQ('')
      setFaqA('')
    }
  }

  const addManual = async (e: FormEvent) => {
    e.preventDefault()
    const kb = bases.find(x => x.id === selectedKb)
    if (!kb) return
    const { error } = await supabase.from('knowledge_documents').insert({
      organization_id: kb.organization_id,
      knowledge_base_id: kb.id,
      title: manualTitle,
      source_type: 'manual_text',
      language: contentLanguage,
      processing_status: 'pending',
      metadata: { manualText },
    })
    setMessage(error?.message ?? tr('تمت إضافة النص إلى قائمة المعالجة.', 'Manual text queued for processing.'))
    if (!error) {
      setManualTitle('')
      setManualText('')
      await load()
    }
  }

  const addUrl = async (e: FormEvent) => {
    e.preventDefault()
    const kb = bases.find(x => x.id === selectedKb)
    if (!kb) return

    let parsed: URL
    try {
      parsed = new URL(sourceUrl.trim())
    } catch {
      setMessage(tr('أدخل رابطًا صحيحًا.', 'Enter a valid URL.'))
      return
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      setMessage(tr('يُسمح بروابط HTTP وHTTPS فقط.', 'Only HTTP and HTTPS URLs are allowed.'))
      return
    }

    const { error } = await supabase.from('knowledge_documents').insert({
      organization_id: kb.organization_id,
      knowledge_base_id: kb.id,
      title: urlTitle.trim() || parsed.hostname,
      source_type: 'url',
      source_url: parsed.toString(),
      language: contentLanguage,
      processing_status: 'pending',
      metadata: {},
    })
    setMessage(error?.message ?? tr('تمت إضافة الرابط إلى قائمة المعالجة.', 'URL queued for processing.'))
    if (!error) {
      setUrlTitle('')
      setSourceUrl('')
      await load()
    }
  }

  const upload = async (file: File) => {
    const kb = bases.find(x => x.id === selectedKb)
    if (!kb) return
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (!ext || !['pdf', 'docx', 'txt'].includes(ext)) {
      setMessage(tr('المسموح PDF / DOCX / TXT فقط.', 'Only PDF / DOCX / TXT files are allowed.'))
      return
    }
    if (file.size > 20 * 1024 * 1024) {
      setMessage(tr('الحد الأقصى 20MB.', 'Maximum file size is 20MB.'))
      return
    }
    const id = crypto.randomUUID()
    const path = `${kb.organization_id}/${kb.id}/${id}/${file.name.replace(/[^\p{L}\p{N}._-]/gu, '_')}`
    const { error: storageError } = await supabase.storage.from('knowledge').upload(path, file, { upsert: false })
    if (storageError) {
      setMessage(storageError.message)
      return
    }
    const { error } = await supabase.from('knowledge_documents').insert({
      id,
      organization_id: kb.organization_id,
      knowledge_base_id: kb.id,
      title: file.name,
      source_type: 'file',
      original_file_name: file.name,
      storage_path: path,
      language: contentLanguage,
      processing_status: 'pending',
    })
    if (error) {
      setMessage(error.message)
      return
    }
    setMessage(tr('تم الرفع ووضع المستند في قائمة المعالجة.', 'File uploaded and queued for processing.'))
    await load()
  }

  const visibleBases = organizationId ? bases.filter(b => b.organization_id === organizationId) : bases
  const visibleDocs = selectedKb ? docs.filter(d => d.knowledge_base_id === selectedKb) : docs

  return <div className="screen screen-knowledge">
    <PageHeader
      title={tr('المعرفة', 'Knowledge')}
      description={tr('نظّم مصادر المعرفة التي يعتمد عليها المساعد: ملفات، صفحات ويب، أسئلة شائعة، ونصوص يدوية.', 'Organize the sources the assistant relies on: files, web pages, FAQs, and manual text.')}
    />

    <Card className="context-panel">
      <PanelHeader
        title={tr('سياق العمل','Working context')}
        description={tr('حدد الجهة وقاعدة المعرفة ولغة المحتوى قبل إضافة أي مصدر.','Choose the organization, knowledge base, and content language before adding a source.')}
        meta={<span className="panel-index">01</span>}
      />
      <div className="grid-form context-grid">
        {profile.role === 'SUPER_ADMIN' && <label>{tr('الجهة', 'Organization')}
          <select value={organizationId} onChange={e => { setOrganizationId(e.target.value); setSelectedKb('') }}>
            <option value="">{tr('اختر الجهة', 'Select organization')}</option>
            {orgs.map(o => <option key={o.id} value={o.id}>{o.name_ar} / {o.name_en}</option>)}
          </select>
          <FieldHint>{tr('تُعزل المعرفة بالكامل بين الجهات؛ اختر الجهة قبل إضافة أي مصدر.', 'Knowledge is fully isolated between organizations; select an organization before adding a source.')}</FieldHint>
        </label>}
        <label>{tr('قاعدة المعرفة', 'Knowledge base')}
          <select value={selectedKb} onChange={e => setSelectedKb(e.target.value)}>
            <option value="">{tr('اختر قاعدة المعرفة', 'Select knowledge base')}</option>
            {visibleBases.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <FieldHint>{tr('استخدم قواعد منفصلة لموضوعات مثل القبول والرسوم والسياسات عندما يفيد ذلك في التنظيم.', 'Use separate bases for topics such as admissions, fees, and policies when it improves organization.')}</FieldHint>
        </label>
        <label>{tr('لغة المحتوى', 'Content language')}
          <select value={contentLanguage} onChange={e => setContentLanguage(e.target.value as AppLanguage)}>
            <option value="ar">{tr('محتوى عربي', 'Arabic content')}</option>
            <option value="en">{tr('محتوى إنجليزي', 'English content')}</option>
          </select>
          <FieldHint>{tr('تُسجل اللغة مع المصدر لتحسين العرض والبحث والتشخيص.', 'The language is stored with the source to improve display, retrieval, and diagnostics.')}</FieldHint>
        </label>
      </div>
      {message && <div className="inline-feedback" role="status">{message}</div>}
    </Card>

    <div className="knowledge-layout">
      <Card className="knowledge-base-panel">
        <PanelHeader
          title={tr('إنشاء قاعدة معرفة', 'Create knowledge base')}
          description={tr('أنشئ حاوية واضحة لمجموعة مصادر مرتبطة بنفس الموضوع.','Create a clear container for sources that belong to the same topic.')}
          meta={<span className="panel-index">02</span>}
        />
        <form className="stack" onSubmit={createKb}>
          <label>{tr('اسم قاعدة المعرفة', 'Knowledge base name')}
            <input required placeholder={tr('مثال: القبول والتسجيل', 'Example: Admissions')} value={kbName} onChange={e => setKbName(e.target.value)} />
          </label>
          <label>{tr('الكود', 'Code')}
            <input required dir="ltr" placeholder="ADMISSIONS" value={kbCode} onChange={e => setKbCode(e.target.value)} />
            <FieldHint>{tr('معرف تقني ثابت يُكتب عادةً بحروف إنجليزية كبيرة وأرقام وشرطة سفلية.', 'A stable technical identifier, usually uppercase letters, numbers, and underscores.')}</FieldHint>
          </label>
          <button disabled={!organizationId}>{tr('إنشاء قاعدة المعرفة', 'Create knowledge base')}</button>
        </form>
      </Card>

      <Card className="source-panel">
        <PanelHeader
          title={tr('إضافة مصدر معرفة', 'Add knowledge source')}
          description={tr('اختر نوع المصدر الأنسب. كل مصدر يدخل نفس مسار المعالجة والعزل الخاص بالجهة.','Choose the most suitable source type. Every source follows the same organization-isolated processing path.')}
          meta={<span className="panel-index">03</span>}
        />
        <div className="source-methods">
          <section className="source-method">
            <div className="source-method-head"><span className="source-method-index">A</span><div><h3>{tr('رفع ملف', 'Upload file')}</h3><p>{tr('للمستندات الرسمية والملفات المرجعية.','For official documents and reference files.')}</p></div></div>
            <label>{tr('اختر ملفًا', 'Choose a file')}
              <input type="file" accept=".pdf,.docx,.txt" disabled={!selectedKb} onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f) }} />
              <FieldHint>{tr('الأنواع المدعومة: PDF وDOCX وTXT، بحد أقصى 20MB. ملفات PDF يجب أن تحتوي على نص قابل للاستخراج.', 'Supported types: PDF, DOCX, and TXT up to 20MB. PDFs must contain extractable text.')}</FieldHint>
            </label>
          </section>

          <section className="source-method">
            <div className="source-method-head"><span className="source-method-index">B</span><div><h3>{tr('صفحة ويب', 'Web page')}</h3><p>{tr('لصفحة عامة محددة تريد إدخال محتواها إلى المعرفة.','For one public page whose content should be added to knowledge.')}</p></div></div>
            <form className="source-inline-form" onSubmit={addUrl}>
              <label>{tr('عنوان المصدر', 'Source title')}
                <input placeholder={tr('اختياري — يُستخدم اسم الموقع إذا تُرك فارغًا', 'Optional — the site name is used if left empty')} value={urlTitle} onChange={e => setUrlTitle(e.target.value)} />
              </label>
              <label className="source-url-field">{tr('رابط الصفحة', 'Page URL')}
                <input required type="url" dir="ltr" inputMode="url" placeholder="https://example.com/page" value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} />
                <FieldHint>{tr('يتم جلب صفحة واحدة فقط. الروابط الداخلية والمحلية محظورة أمنيًا، والحد الأقصى للصفحة 2MB.', 'One page only. Private/internal addresses are blocked for security and the page limit is 2MB.')}</FieldHint>
              </label>
              <button disabled={!selectedKb}>{tr('إضافة صفحة الويب', 'Add web page')}</button>
            </form>
          </section>

          <section className="source-method">
            <div className="source-method-head"><span className="source-method-index">C</span><div><h3>{tr('نص يدوي', 'Manual text')}</h3><p>{tr('للسياسات القصيرة أو المعلومات التي لا تحتاج ملفًا مستقلًا.','For short policies or information that does not need a separate file.')}</p></div></div>
            <form className="source-inline-form" onSubmit={addManual}>
              <label>{tr('عنوان النص', 'Text title')}
                <input required placeholder={tr('مثال: سياسة استرداد الرسوم', 'Example: Refund policy')} value={manualTitle} onChange={e => setManualTitle(e.target.value)} />
              </label>
              <label className="source-text-field">{tr('المحتوى', 'Content')}
                <textarea required rows={4} value={manualText} onChange={e => setManualText(e.target.value)} placeholder={tr('ألصق النص الذي تريد إضافته إلى المعرفة.', 'Paste the text you want to add to knowledge.')} />
              </label>
              <button disabled={!selectedKb}>{tr('إضافة النص', 'Add text')}</button>
            </form>
          </section>
        </div>
      </Card>
    </div>

    <Card className="faq-panel">
      <PanelHeader
        title={tr('الأسئلة الشائعة', 'FAQ')}
        description={tr('أضف إجابات معتمدة يمكن استخدامها مباشرة عند وجود تطابق قوي لتقليل التكلفة وزيادة الثبات.','Add approved answers that can be returned directly on a strong match to reduce cost and improve consistency.')}
        meta={<span className="panel-index">04</span>}
      />
      <form className="grid-form faq-form" onSubmit={addFaq}>
        <label>{tr('السؤال', 'Question')}
          <input required placeholder={tr('مثال: ما مواعيد التسجيل؟', 'Example: When does registration open?')} value={faqQ} onChange={e => setFaqQ(e.target.value)} />
        </label>
        <label>{tr('الإجابة المعتمدة', 'Approved answer')}
          <input required placeholder={tr('الإجابة التي يمكن إرجاعها مباشرة للعميل', 'The answer that can be returned directly to the customer')} value={faqA} onChange={e => setFaqA(e.target.value)} />
          <FieldHint>{tr('الإجابة الواضحة والدقيقة تساعد على توفير تكلفة استدعاء النموذج عند وجود تطابق قوي.', 'A clear, precise answer can save model-call cost when there is a strong FAQ match.')}</FieldHint>
        </label>
        <div className="form-submit-row"><button disabled={!selectedKb}>{tr('إضافة سؤال شائع', 'Add FAQ')}</button></div>
      </form>
    </Card>

    <Card className="table-card documents-panel">
      <PanelHeader
        title={tr('المستندات والمصادر', 'Documents and sources')}
        description={tr('تابع حالة كل مصدر وما إذا انتهت معالجته وأصبح جاهزًا للاستخدام.','Track each source and whether processing has finished and it is ready for use.')}
        meta={<Badge>{tr(`${visibleDocs.length} مصدر`,`${visibleDocs.length} sources`)}</Badge>}
      />
      {visibleDocs.length === 0 ? <Empty>{tr('لا توجد مستندات أو مصادر.', 'No documents or sources found.')}</Empty> : <table className="data-table">
        <thead><tr>
          <th>{tr('العنوان', 'Title')}</th>
          <th>{tr('النوع', 'Type')}</th>
          <th>{tr('اللغة', 'Language')}</th>
          <th>{tr('الحالة', 'Status')}</th>
          <th>{tr('حالة المعالجة', 'Processing status')}</th>
        </tr></thead>
        <tbody>{visibleDocs.map(d => <tr key={d.id}>
          <td className="cell-primary">
            <div>{d.title}</div>
            {d.source_url && <small><a href={d.source_url} target="_blank" rel="noreferrer" dir="ltr">{d.source_url}</a></small>}
          </td>
          <td>{valueLabel(d.source_type)}</td>
          <td>{valueLabel(d.language)}</td>
          <td><Badge tone={d.is_active ? 'good' : 'bad'}>{d.is_active ? tr('نشط', 'Active') : tr('متوقف', 'Inactive')}</Badge></td>
          <td><Badge tone={d.processing_status === 'ready' ? 'good' : d.processing_status === 'failed' ? 'bad' : 'warn'}>{valueLabel(d.processing_status)}</Badge>{d.processing_error && <small className="error-text"> — {valueLabel(d.processing_error)}</small>}</td>
        </tr>)}</tbody>
      </table>}
    </Card>
  </div>
}
