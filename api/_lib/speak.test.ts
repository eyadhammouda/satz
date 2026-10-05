import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, MAX_LENGTH, resetVoiceForTests } from '../speak.js'
import { createSession, readSessionConfig, SESSION_COOKIE } from './auth.js'

const env = {
  ALLOWED_EMAIL: 'me@example.com',
  SESSION_SECRET: 'x'.repeat(48),
  ELEVENLABS_API_KEY: 'test-key',
  ELEVENLABS_VOICE_ID: 'voice-1',
}
const saved = { ...process.env }

beforeEach(() => Object.assign(process.env, env))
afterEach(() => {
  process.env = { ...saved }
  vi.unstubAllGlobals()
  resetVoiceForTests()
})

async function request(text: string | null, signedIn = true) {
  const url = new URL('https://satz.test/api/speak')
  if (text !== null) url.searchParams.set('text', text)
  const headers: Record<string, string> = {}
  if (signedIn) headers.cookie = `${SESSION_COOKIE}=${await createSession('me@example.com', readSessionConfig()!.secret)}`
  return GET(new Request(url, { headers }))
}

function fakeElevenLabs(status = 200, voices: unknown[] = []) {
  const calls: { url: string; init: RequestInit }[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    if (url.startsWith('https://api.elevenlabs.io/v2/voices')) return Response.json({ voices })
    calls.push({ url, init })
    return status === 200
      ? new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'audio/mpeg' } })
      : new Response('quota exceeded', { status })
  })
  return calls
}

describe('/api/speak', () => {
  it('returns audio for a signed-in request and keeps the key on the server', async () => {
    const calls = fakeElevenLabs()
    const response = await request('Lass mich mal sehen')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('audio/mpeg')
    expect(response.headers.get('cache-control')).toContain('private')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))

    expect(calls[0].url).toBe('https://api.elevenlabs.io/v1/text-to-speech/voice-1?output_format=mp3_44100_128')
    expect((calls[0].init.headers as Record<string, string>)['xi-api-key']).toBe('test-key')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ text: 'Lass mich mal sehen', model_id: 'eleven_v4' })
  })

  it('refuses a request without a session and never calls ElevenLabs', async () => {
    const calls = fakeElevenLabs()
    expect((await request('Hallo', false)).status).toBe(404)
    expect(calls).toHaveLength(0)
  })

  it('refuses empty and overly long text', async () => {
    const calls = fakeElevenLabs()
    expect((await request(null)).status).toBe(400)
    expect((await request('   ')).status).toBe(400)
    expect((await request('a'.repeat(MAX_LENGTH + 1))).status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  it('picks a German voice from the account when none is set', async () => {
    delete process.env.ELEVENLABS_VOICE_ID
    const calls = fakeElevenLabs(200, [
      { voice_id: 'premade-en', category: 'premade', verified_languages: [{ language: 'en' }] },
      { voice_id: 'german', category: 'professional', verified_languages: [{ language: 'en' }, { language: 'de' }] },
    ])
    expect((await request('Hallo')).status).toBe(200)
    expect(calls[0].url).toContain('/text-to-speech/german?')
  })

  it('falls back to a premade voice when no German one exists', async () => {
    delete process.env.ELEVENLABS_VOICE_ID
    const calls = fakeElevenLabs(200, [
      { voice_id: 'cloned', category: 'cloned' },
      { voice_id: 'premade-1', category: 'premade' },
    ])
    await request('Hallo')
    expect(calls[0].url).toContain('/text-to-speech/premade-1?')
  })

  it('reports 503 when the key is missing or no voice exists, so the app falls back to the browser voice', async () => {
    delete process.env.ELEVENLABS_VOICE_ID
    fakeElevenLabs(200, [])
    expect((await request('Hallo')).status).toBe(503)
    delete process.env.ELEVENLABS_API_KEY
    expect((await request('Hallo')).status).toBe(503)
  })

  it('reports 502 when ElevenLabs fails', async () => {
    fakeElevenLabs(401)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await request('Hallo')
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain('test-key')
  })
})
