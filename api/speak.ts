import { hasValidSession, readSessionConfig } from './_lib/auth.js'

export const MAX_LENGTH = 300
const DEFAULT_MODEL = 'eleven_v4'

/** Turns one German sentence into speech with ElevenLabs. The key never leaves the server. */
export async function GET(request: Request): Promise<Response> {
  // The middleware already checks the session. Check again so this endpoint is safe on its own.
  if (!(await hasValidSession(request, readSessionConfig()))) return text('Not found', 404)

  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) return text('Speech is not set up', 503)
  const voiceId = await resolveVoiceId(apiKey)
  if (!voiceId) return text('No voice available', 503)

  const sentence = new URL(request.url).searchParams.get('text')?.normalize('NFC').trim() ?? ''
  if (!sentence || sentence.length > MAX_LENGTH) return text('Bad request', 400)

  const upstream = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text: sentence, model_id: process.env.ELEVENLABS_MODEL_ID || DEFAULT_MODEL }),
    },
  ).catch(() => null)

  if (!upstream?.ok) {
    // Logged for the Vercel function logs. Contains no secrets.
    console.error('ElevenLabs request failed', upstream?.status, (await upstream?.text().catch(() => ''))?.slice(0, 300))
    return text('Speech failed', 502)
  }

  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'audio/mpeg',
      // The browser keeps each sentence for a year. The CDN cache sits behind the
      // session check and is cleared on every deploy, so a new voice takes effect.
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Vercel-CDN-Cache-Control': 'max-age=31536000',
    },
  })
}

interface Voice {
  voice_id: string
  category?: string
  verified_languages?: { language?: string }[]
}

let chosenVoice: Promise<string | null> | undefined

/** ELEVENLABS_VOICE_ID when set, otherwise the first voice on the account verified for German, otherwise a premade voice. */
export function resolveVoiceId(apiKey: string): Promise<string | null> {
  const configured = process.env.ELEVENLABS_VOICE_ID
  if (configured) return Promise.resolve(configured)
  chosenVoice ??= fetch('https://api.elevenlabs.io/v2/voices?page_size=100', { headers: { 'xi-api-key': apiKey } })
    .then(async (response) => {
      if (!response.ok) return null
      const { voices } = (await response.json()) as { voices: Voice[] }
      const german = voices.find((v) => v.verified_languages?.some((l) => l.language === 'de'))
      return (german ?? voices.find((v) => v.category === 'premade') ?? voices[0])?.voice_id ?? null
    })
    .catch(() => null)
    .then((id) => {
      if (!id) chosenVoice = undefined
      return id
    })
  return chosenVoice
}

export function resetVoiceForTests() {
  chosenVoice = undefined
}

function text(body: string, status: number): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } })
}
