import { hasValidSession, readSessionConfig } from './_lib/auth.js'

export const MAX_LENGTH = 300
const DEFAULT_MODEL = 'eleven_v4'

/** Turns one German sentence into speech with ElevenLabs. The key never leaves the server. */
export async function GET(request: Request): Promise<Response> {
  // The middleware already checks the session. Check again so this endpoint is safe on its own.
  if (!(await hasValidSession(request, readSessionConfig()))) return text('Not found', 404)

  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) return text('Speech is not set up', 503)
  const voiceId = resolveVoiceId()

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

/** Chris, an Austrian German voice from the ElevenLabs voice library. */
export const AUSTRIAN_VOICE_ID = 'l4QW1L3S9K8vu4mB7I0i'

/** ELEVENLABS_VOICE_ID when set, otherwise the Austrian voice. */
export const resolveVoiceId = () => process.env.ELEVENLABS_VOICE_ID || AUSTRIAN_VOICE_ID

function text(body: string, status: number): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } })
}
