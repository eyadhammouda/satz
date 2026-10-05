import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTVerifyGetKey } from 'jose'

export const SESSION_COOKIE = '__Host-satz_session'
export const OAUTH_COOKIE = '__Host-satz_oauth'
export const SESSION_DAYS = 60
const OAUTH_MINUTES = 10

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com']

export interface AuthConfig {
  clientId: string
  clientSecret: string
  allowedEmail: string
  secret: Uint8Array
}

/** Reads the auth settings. Returns null when any are missing, so callers fail closed. */
export function readConfig(env: Record<string, string | undefined> = process.env): AuthConfig | null {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ALLOWED_EMAIL, SESSION_SECRET } = env
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !ALLOWED_EMAIL || !SESSION_SECRET) return null
  if (SESSION_SECRET.length < 32) return null
  return {
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    allowedEmail: ALLOWED_EMAIL.trim().toLowerCase(),
    secret: new TextEncoder().encode(SESSION_SECRET),
  }
}

/** The session check needs only the secret and the email, not the Google client. */
export function readSessionConfig(env: Record<string, string | undefined> = process.env) {
  const { ALLOWED_EMAIL, SESSION_SECRET } = env
  if (!ALLOWED_EMAIL || !SESSION_SECRET || SESSION_SECRET.length < 32) return null
  return { allowedEmail: ALLOWED_EMAIL.trim().toLowerCase(), secret: new TextEncoder().encode(SESSION_SECRET) }
}

export function getCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie')
  if (!header) return undefined
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index !== -1 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim()
  }
  return undefined
}

export function cookie(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`
}

export async function createSession(email: string, secret: Uint8Array): Promise<string> {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience('satz:session')
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret)
}

/** True when the request carries a valid session for the allowed email. */
export async function hasValidSession(
  request: Request,
  config: { allowedEmail: string; secret: Uint8Array } | null,
): Promise<boolean> {
  if (!config) return false
  const token = getCookie(request, SESSION_COOKIE)
  if (!token) return false
  try {
    const { payload } = await jwtVerify(token, config.secret, { algorithms: ['HS256'], audience: 'satz:session' })
    return typeof payload.email === 'string' && payload.email.toLowerCase() === config.allowedEmail
  } catch {
    return false
  }
}

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export function randomToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)))
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(new Uint8Array(digest))
}

export interface OAuthState {
  state: string
  verifier: string
  nonce: string
}

export async function sealOAuthState(value: OAuthState, secret: Uint8Array): Promise<string> {
  return new SignJWT({ ...value })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience('satz:oauth')
    .setIssuedAt()
    .setExpirationTime(`${OAUTH_MINUTES}m`)
    .sign(secret)
}

export async function openOAuthState(token: string, secret: Uint8Array): Promise<OAuthState | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'], audience: 'satz:oauth' })
    const { state, verifier, nonce } = payload
    if (typeof state !== 'string' || typeof verifier !== 'string' || typeof nonce !== 'string') return null
    return { state, verifier, nonce }
  } catch {
    return null
  }
}

export function callbackUrl(request: Request): string {
  return new URL('/api/auth/callback', request.url).toString()
}

export function googleAuthUrl(request: Request, config: AuthConfig, oauth: OAuthState, challenge: string): string {
  const url = new URL(GOOGLE_AUTH_URL)
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: callbackUrl(request),
    response_type: 'code',
    scope: 'openid email',
    state: oauth.state,
    nonce: oauth.nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    login_hint: config.allowedEmail,
    prompt: 'select_account',
  }).toString()
  return url.toString()
}

let googleKeys: JWTVerifyGetKey | undefined
export function googleJwks(): JWTVerifyGetKey {
  googleKeys ??= createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))
  return googleKeys
}

/** Verifies a Google ID token and returns its email when it is verified and allowed. */
export async function verifyGoogleIdToken(
  idToken: string,
  config: Pick<AuthConfig, 'clientId' | 'allowedEmail'>,
  nonce: string,
  keys: JWTVerifyGetKey = googleJwks(),
): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(idToken, keys, { issuer: GOOGLE_ISSUERS, audience: config.clientId })
    if (payload.nonce !== nonce) return null
    if (payload.email_verified !== true || typeof payload.email !== 'string') return null
    const email = payload.email.toLowerCase()
    return email === config.allowedEmail ? email : null
  } catch {
    return null
  }
}

export function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' })
  for (const c of cookies) headers.append('Set-Cookie', c)
  return new Response(null, { status: 302, headers })
}
