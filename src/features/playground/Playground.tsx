import { useState } from 'react'
import { functionsBaseUrl, supabase } from '../../lib/supabase'
import { Card, PageHeader } from '../../components/Ui'

interface Result {
  answer?: string
  intent?: string
  confidence?: number
  sources?: Array<{
    documentId: string
    page: number | null
    similarity: number
    preview: string
  }>
  usage?: Record<string, number>
  latencyMs?: number
  error?: string
}

export function Playground() {
  const [organizationId, setOrganizationId] = useState('')
  const [knowledgeBaseId, setKnowledgeBaseId] = useState('')
  const [question, setQuestion] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const [loading, setLoading] = useState(false)

  const run = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoading(true)

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session) {
        setResult({ error: 'Not authenticated' })
        return
      }

      const response = await fetch(`${functionsBaseUrl}/playground`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${session.access_token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          organizationId,
          knowledgeBaseId: knowledgeBaseId || null,
          question,
        }),
      })

      setResult((await response.json()) as Result)
    } catch (error) {
      setResult({
        error: error instanceof Error ? error.message : 'Playground request failed',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <PageHeader
        title="AI Playground"
        description="Test mode بدون حفظ Conversation."
      />
      <div className="split">
        <Card>
          <form className="stack" onSubmit={run}>
            <input
              required
              placeholder="Organization UUID"
              value={organizationId}
              onChange={(event) => setOrganizationId(event.target.value)}
            />
            <input
              placeholder="Knowledge Base UUID (optional)"
              value={knowledgeBaseId}
              onChange={(event) => setKnowledgeBaseId(event.target.value)}
            />
            <textarea
              required
              rows={7}
              placeholder="السؤال"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
            />
            <button disabled={loading}>
              {loading ? 'جارٍ الاختبار…' : 'اختبار'}
            </button>
          </form>
        </Card>

        <Card>
          <h2>Diagnostics</h2>
          {result && (
            <>
              <pre className="answer">{result.answer ?? result.error}</pre>
              <p>
                Intent: {result.intent ?? '—'} · Confidence:{' '}
                {result.confidence ?? '—'} · Latency: {result.latencyMs ?? '—'} ms
              </p>
              <div>
                {result.sources?.map((source, index) => (
                  <div className="source" key={`${source.documentId}-${index}`}>
                    <strong>
                      Top {index + 1}: {source.similarity.toFixed(3)}
                    </strong>
                    <small>
                      {source.documentId} · page {source.page ?? '—'}
                    </small>
                    <p>{source.preview}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      </div>
    </>
  )
}
