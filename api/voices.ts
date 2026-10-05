import { hasValidSession, readSessionConfig } from './_lib/auth.js'

interface ElevenVoice {
  voice_id: string
  name: string
  category?: string
  labels?: Record<string, string>
  preview_url?: string
  verified_languages?: { language?: string; accent?: string; preview_url?: string }[]
}

/** Lists the ElevenLabs voices this key can use, German ones first. For picking ELEVENLABS_VOICE_ID. */
export async function GET(request: Request): Promise<Response> {
  if (!(await hasValidSession(request, readSessionConfig()))) return new Response('Not found', { status: 404 })
  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) return new Response('Speech is not set up', { status: 503 })

  const upstream = await fetch('https://api.elevenlabs.io/v2/voices?page_size=100', {
    headers: { 'xi-api-key': apiKey },
  }).catch(() => null)
  if (!upstream?.ok) {
    return Response.json({ error: 'ElevenLabs request failed', status: upstream?.status ?? null }, { status: 502 })
  }

  const { voices } = (await upstream.json()) as { voices: ElevenVoice[] }
  const isGerman = (v: ElevenVoice) =>
    v.verified_languages?.some((l) => l.language === 'de') || /german|deutsch/i.test(JSON.stringify(v.labels ?? {}))
  const list = voices
    .map((v) => ({
      voice_id: v.voice_id,
      name: v.name,
      category: v.category,
      german: Boolean(isGerman(v)),
      labels: v.labels,
      preview: v.verified_languages?.find((l) => l.language === 'de')?.preview_url ?? v.preview_url,
    }))
    .sort((a, b) => Number(b.german) - Number(a.german))
  return Response.json(list, { headers: { 'Cache-Control': 'no-store' } })
}
