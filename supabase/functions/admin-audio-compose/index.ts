import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createAdminClient, json } from '../_shared/runtime.ts'

type SegmentInput = {
  storagePath?: string
  startMs?: number
  endMs?: number
}

interface Body {
  organizationId?: string
  fileName?: string
  totalDurationMs?: number
  segments?: SegmentInput[]
}

type ParsedWav = {
  sampleRate: number
  channels: number
  bitsPerSample: number
  pcm: Uint8Array
}

const MAX_TOTAL_MS = 10 * 60 * 1000
const MAX_SEGMENTS = 80

const cleanFileName = (value: string | undefined) => {
  const base = (value ?? 'composed-audio.wav').trim().replace(/[^A-Za-z0-9._-]/g, '-').replace(/-+/g, '-').slice(0, 100)
  return base.toLowerCase().endsWith('.wav') ? base : `${base || 'composed-audio'}.wav`
}

async function authenticate(req: Request, admin: ReturnType<typeof createAdminClient>) {
  const supplied = req.headers.get('x-worker-token')
  if (supplied) {
    const secret = await admin.rpc('get_background_worker_token')
    if (!secret.error && secret.data === supplied) return true
  }

  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return false
  const user = await admin.auth.getUser(auth.slice(7))
  if (user.error || !user.data.user) return false
  const profile = await admin.from('profiles').select('role,is_active').eq('id', user.data.user.id).single()
  return !profile.error && Boolean(profile.data?.is_active) && profile.data?.role === 'SUPER_ADMIN'
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

function parseWav(bytes: Uint8Array): ParsedWav {
  if (bytes.length < 44 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WAVE') {
    throw new Error('invalid_wav')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let sampleRate = 0
  let channels = 0
  let bitsPerSample = 0
  let audioFormat = 0
  let pcm: Uint8Array | null = null
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const id = ascii(bytes, offset, 4)
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8
    if (body + size > bytes.length) throw new Error('invalid_wav_chunk')
    if (id === 'fmt ' && size >= 16) {
      audioFormat = view.getUint16(body, true)
      channels = view.getUint16(body + 2, true)
      sampleRate = view.getUint32(body + 4, true)
      bitsPerSample = view.getUint16(body + 14, true)
    } else if (id === 'data') {
      pcm = bytes.slice(body, body + size)
    }
    offset = body + size + (size % 2)
  }
  if (!pcm || !sampleRate || audioFormat !== 1 || channels !== 1 || bitsPerSample !== 16) {
    throw new Error('unsupported_wav_format')
  }
  return { sampleRate, channels, bitsPerSample, pcm }
}

function wavFromPcm(pcm: Uint8Array, sampleRate: number) {
  const header = new ArrayBuffer(44)
  const view = new DataView(header)
  const write = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index))
  }
  const byteRate = sampleRate * 2
  write(0, 'RIFF')
  view.setUint32(4, 36 + pcm.length, true)
  write(8, 'WAVE')
  write(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  write(36, 'data')
  view.setUint32(40, pcm.length, true)
  const output = new Uint8Array(44 + pcm.length)
  output.set(new Uint8Array(header), 0)
  output.set(pcm, 44)
  return output
}

function toInt16(pcm: Uint8Array) {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  const samples = new Int16Array(Math.floor(pcm.length / 2))
  for (let index = 0; index < samples.length; index += 1) samples[index] = view.getInt16(index * 2, true)
  return samples
}

function resampleToLength(source: Int16Array, targetLength: number) {
  if (targetLength <= 0) return new Int16Array(0)
  if (source.length === targetLength) return source
  if (source.length <= 1) {
    const out = new Int16Array(targetLength)
    if (source.length === 1) out.fill(source[0])
    return out
  }
  const out = new Int16Array(targetLength)
  const ratio = (source.length - 1) / Math.max(1, targetLength - 1)
  for (let index = 0; index < targetLength; index += 1) {
    const position = index * ratio
    const left = Math.floor(position)
    const right = Math.min(source.length - 1, left + 1)
    const fraction = position - left
    out[index] = Math.round(source[left] * (1 - fraction) + source[right] * fraction)
  }
  return out
}

function int16ToBytes(samples: Int16Array) {
  const bytes = new Uint8Array(samples.length * 2)
  const view = new DataView(bytes.buffer)
  for (let index = 0; index < samples.length; index += 1) view.setInt16(index * 2, samples[index], true)
  return bytes
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ success: false, error: 'method_not_allowed' }, 405)
  const admin = createAdminClient()
  if (!await authenticate(req, admin)) return json({ success: false, error: 'unauthorized' }, 401)

  let outputPath = ''
  try {
    const body = await req.json() as Body
    const organizationId = body.organizationId?.trim() ?? ''
    const totalDurationMs = Math.round(Number(body.totalDurationMs ?? 0))
    const segments = Array.isArray(body.segments) ? body.segments : []
    if (!organizationId) return json({ success: false, error: 'organization_id_required' }, 400)
    if (!Number.isFinite(totalDurationMs) || totalDurationMs <= 0 || totalDurationMs > MAX_TOTAL_MS) {
      return json({ success: false, error: 'invalid_total_duration' }, 400)
    }
    if (!segments.length || segments.length > MAX_SEGMENTS) return json({ success: false, error: 'invalid_segments' }, 400)

    const allowedPrefix = `${organizationId}/exports/`
    let sampleRate = 0
    const loaded: Array<{ startMs: number; endMs: number | null; samples: Int16Array }> = []
    for (const raw of segments) {
      const storagePath = raw.storagePath?.trim() ?? ''
      const startMs = Math.round(Number(raw.startMs ?? -1))
      const endValue = raw.endMs == null ? null : Math.round(Number(raw.endMs))
      if (!storagePath.startsWith(allowedPrefix) || storagePath.includes('..')) throw new Error('invalid_segment_path')
      if (!Number.isFinite(startMs) || startMs < 0 || startMs >= totalDurationMs) throw new Error('invalid_segment_start')
      if (endValue != null && (!Number.isFinite(endValue) || endValue <= startMs || endValue > totalDurationMs)) throw new Error('invalid_segment_end')

      const downloaded = await admin.storage.from('chat-media').download(storagePath)
      if (downloaded.error || !downloaded.data) throw downloaded.error ?? new Error('segment_download_failed')
      const parsed = parseWav(new Uint8Array(await downloaded.data.arrayBuffer()))
      if (!sampleRate) sampleRate = parsed.sampleRate
      if (parsed.sampleRate !== sampleRate) throw new Error('sample_rate_mismatch')
      loaded.push({ startMs, endMs: endValue, samples: toInt16(parsed.pcm) })
    }

    const totalSamples = Math.round(totalDurationMs * sampleRate / 1000)
    const mixed = new Int32Array(totalSamples)
    for (const segment of loaded) {
      const startSample = Math.round(segment.startMs * sampleRate / 1000)
      let source = segment.samples
      if (segment.endMs != null) {
        const available = Math.max(1, Math.round((segment.endMs - segment.startMs) * sampleRate / 1000))
        if (source.length > available) source = resampleToLength(source, available)
      }
      const availableOutput = Math.max(0, totalSamples - startSample)
      const length = Math.min(source.length, availableOutput)
      for (let index = 0; index < length; index += 1) mixed[startSample + index] += source[index]
    }

    const finalSamples = new Int16Array(totalSamples)
    for (let index = 0; index < mixed.length; index += 1) finalSamples[index] = Math.max(-32768, Math.min(32767, mixed[index]))
    const wav = wavFromPcm(int16ToBytes(finalSamples), sampleRate)

    outputPath = `${organizationId}/exports/${crypto.randomUUID()}-${cleanFileName(body.fileName)}`
    const uploaded = await admin.storage.from('chat-media').upload(outputPath, wav, {
      contentType: 'audio/wav',
      upsert: false,
      cacheControl: '0',
    })
    if (uploaded.error) throw uploaded.error

    const signed = await admin.storage.from('chat-media').createSignedUrl(outputPath, 86400)
    if (signed.error || !signed.data?.signedUrl) throw signed.error ?? new Error('signed_url_failed')

    return json({
      success: true,
      audio: {
        url: signed.data.signedUrl,
        storagePath: outputPath,
        mimeType: 'audio/wav',
        durationMs: totalDurationMs,
        sampleRate,
        segments: segments.length,
      },
    })
  } catch (error) {
    if (outputPath) await admin.storage.from('chat-media').remove([outputPath]).catch(() => undefined)
    return json({ success: false, error: error instanceof Error ? error.message : 'audio_compose_failed' }, 500)
  }
})
