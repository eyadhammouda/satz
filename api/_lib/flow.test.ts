import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getCookie, hasValidSession, OAUTH_COOKIE, readConfig, SESSION_COOKIE } from './auth.js'
import { GET as callback } from '../auth/callback.js'
import { GET as login } from '../auth/login.js'
import { POST as logout } from '../auth/logout.js'

const env = {
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  ALLOWED_EMAIL: 'me@example.com',
  SESSION_SECRET: 'x'.repeat(48),
}
const saved = { ...process.env }
const origin = 'https://satz.test'

let privateKey: CryptoKey
let jwk: Record<string, unknown>
beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  privateKey = pair.privateKey
  jwk = { ...(await exportJWK(pair.publicKey)), kid: 'google-test', alg: 'RS256', use: 'sig' }
})

beforeEach(() => Object.assign(process.env, env))
afterEach(() => {
  process.env = { ...saved }
  vi.unstubAllGlobals()
})

const cookiesOf = (response: Response) => response.headers.getSetCookie()
const cookieValue = (response: Response, name: string) =>
  cookiesOf(response)
    .find((c) => c.startsWith(`${name}=`))
    ?.split(';')[0]
    .slice(name.length + 1)

/** Starts a login and returns what Google would receive and the cookie the browser keeps. */
async function startLogin() {
  const response = await login(new Request(`${origin}/api/auth/login`))
  expect(response.status).toBe(302)
  const google = new URL(response.headers.get('location')!)
  return { google, oauthCookie: cookieValue(response, OAUTH_COOKIE)! }
}

/** Fakes Google's token endpoint and key set. */
function fakeGoogle(claims: Record<string, unknown>) {
  const seen: URLSearchParams[] = []
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.startsWith('https://www.googleapis.com/oauth2/v3/certs')) return Response.json({ keys: [jwk] })
    if (url === 'https://oauth2.googleapis.com/token') {
      seen.push(new URLSearchParams(String(init?.body)))
      const idToken = await new SignJWT({ email_verified: true, ...claims })
        .setProtectedHeader({ alg: 'RS256', kid: 'google-test' })
        .setIssuer('https://accounts.google.com')
        .setAudience('client-id')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey)
      return Response.json({ id_token: idToken })
    }
    throw new Error(`Unexpected fetch ${url}`)
  })
  return seen
}

const callbackRequest = (params: Record<string, string>, oauthCookie?: string) =>
  new Request(`${origin}/api/auth/callback?${new URLSearchParams(params)}`, {
    headers: oauthCookie ? { cookie: `${OAUTH_COOKIE}=${oauthCookie}` } : {},
  })

describe('sign-in flow', () => {
  it('sends the browser to Google with PKCE, state, nonce and the owner as hint', async () => {
    const { google, oauthCookie } = await startLogin()
    expect(google.origin + google.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    const p = google.searchParams
    expect(p.get('client_id')).toBe('client-id')
    expect(p.get('redirect_uri')).toBe(`${origin}/api/auth/callback`)
    expect(p.get('scope')).toBe('openid email')
    expect(p.get('code_challenge_method')).toBe('S256')
    expect(p.get('login_hint')).toBe('me@example.com')
    expect(p.get('state')).toBeTruthy()
    expect(p.get('nonce')).toBeTruthy()
    expect(oauthCookie).toBeTruthy()
  })

  it('signs the owner in and sets a secure session cookie', async () => {
    const { google, oauthCookie } = await startLogin()
    const sent = fakeGoogle({ email: 'Me@Example.com', nonce: google.searchParams.get('nonce') })
    const response = await callback(callbackRequest({ code: 'abc', state: google.searchParams.get('state')! }, oauthCookie))

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/')
    expect(sent[0].get('code')).toBe('abc')
    expect(sent[0].get('code_verifier')).toBeTruthy()

    const session = cookiesOf(response).find((c) => c.startsWith(`${SESSION_COOKIE}=`))!
    expect(session).toMatch(/HttpOnly/)
    expect(session).toMatch(/Secure/)
    expect(session).toMatch(/SameSite=Lax/)
    const token = cookieValue(response, SESSION_COOKIE)!
    const next = new Request(`${origin}/`, { headers: { cookie: `${SESSION_COOKIE}=${token}` } })
    expect(getCookie(next, SESSION_COOKIE)).toBe(token)
    expect(await hasValidSession(next, readConfig())).toBe(true)
  })

  it('refuses any other Google account', async () => {
    const { google, oauthCookie } = await startLogin()
    fakeGoogle({ email: 'someone@gmail.com', nonce: google.searchParams.get('nonce') })
    const response = await callback(callbackRequest({ code: 'abc', state: google.searchParams.get('state')! }, oauthCookie))
    expect(response.headers.get('location')).toBe('/login?error=denied')
    expect(cookieValue(response, SESSION_COOKIE)).toBeUndefined()
  })

  it('refuses a mismatched state, a missing state cookie and a replayed nonce', async () => {
    const { google, oauthCookie } = await startLogin()
    fakeGoogle({ email: 'me@example.com', nonce: 'not-the-nonce' })
    const state = google.searchParams.get('state')!
    expect((await callback(callbackRequest({ code: 'abc', state: 'forged' }, oauthCookie))).headers.get('location')).toBe(
      '/login?error=failed',
    )
    expect((await callback(callbackRequest({ code: 'abc', state }))).headers.get('location')).toBe('/login?error=failed')
    expect((await callback(callbackRequest({ code: 'abc', state }, oauthCookie))).headers.get('location')).toBe(
      '/login?error=denied',
    )
  })

  it('stays locked when sign-in is not configured', async () => {
    delete process.env.GOOGLE_CLIENT_ID
    const response = await login(new Request(`${origin}/api/auth/login`))
    expect(response.headers.get('location')).toBe('/login?error=setup')
  })

  it('signs out by clearing the session', async () => {
    const response = logout()
    expect(response.headers.get('location')).toBe('/login')
    expect(cookiesOf(response).find((c) => c.startsWith(`${SESSION_COOKIE}=;`))).toMatch(/Max-Age=0/)
  })
})
