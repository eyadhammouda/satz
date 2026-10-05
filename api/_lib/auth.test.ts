import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet } from 'jose'
import { describe, expect, it } from 'vitest'
import {
  createSession,
  getCookie,
  hasValidSession,
  openOAuthState,
  pkceChallenge,
  readConfig,
  readSessionConfig,
  sealOAuthState,
  SESSION_COOKIE,
  verifyGoogleIdToken,
} from './auth.js'

const env = {
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  ALLOWED_EMAIL: 'Me@Example.com',
  SESSION_SECRET: 'x'.repeat(48),
}
const config = readConfig(env)!

const withCookie = (value: string) =>
  new Request('https://satz.test/', { headers: { cookie: `other=1; ${SESSION_COOKIE}=${value}` } })

describe('config', () => {
  it('fails closed when a setting is missing or the secret is short', () => {
    expect(readConfig({ ...env, GOOGLE_CLIENT_SECRET: undefined })).toBeNull()
    expect(readConfig({ ...env, SESSION_SECRET: 'short' })).toBeNull()
    expect(readSessionConfig({ ...env, ALLOWED_EMAIL: '' })).toBeNull()
  })

  it('lowercases the allowed email', () => {
    expect(config.allowedEmail).toBe('me@example.com')
  })
})

describe('sessions', () => {
  it('reads cookies by exact name', () => {
    const request = new Request('https://satz.test/', { headers: { cookie: 'a=1; ab=2; b=3' } })
    expect(getCookie(request, 'a')).toBe('1')
    expect(getCookie(request, 'b')).toBe('3')
    expect(getCookie(request, 'c')).toBeUndefined()
  })

  it('accepts a session for the allowed email', async () => {
    const token = await createSession('me@example.com', config.secret)
    expect(await hasValidSession(withCookie(token), config)).toBe(true)
  })

  it('rejects no cookie, a different email, a different secret, a tampered token and missing config', async () => {
    expect(await hasValidSession(new Request('https://satz.test/'), config)).toBe(false)
    expect(await hasValidSession(withCookie(await createSession('else@example.com', config.secret)), config)).toBe(false)
    const foreign = await createSession('me@example.com', new TextEncoder().encode('y'.repeat(48)))
    expect(await hasValidSession(withCookie(foreign), config)).toBe(false)
    const token = await createSession('me@example.com', config.secret)
    expect(await hasValidSession(withCookie(token.slice(0, -2) + 'xx'), config)).toBe(false)
    expect(await hasValidSession(withCookie(token), null)).toBe(false)
  })

  it('does not accept the OAuth state token as a session', async () => {
    const sealed = await sealOAuthState({ state: 's', verifier: 'v', nonce: 'n' }, config.secret)
    expect(await hasValidSession(withCookie(sealed), config)).toBe(false)
  })

  it('rejects an expired session', async () => {
    const expired = await new SignJWT({ email: 'me@example.com' })
      .setProtectedHeader({ alg: 'HS256' })
      .setAudience('satz:session')
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(config.secret)
    expect(await hasValidSession(withCookie(expired), config)).toBe(false)
  })
})

describe('oauth state', () => {
  it('round trips and rejects a session token', async () => {
    const value = { state: 's', verifier: 'v', nonce: 'n' }
    expect(await openOAuthState(await sealOAuthState(value, config.secret), config.secret)).toEqual(value)
    expect(await openOAuthState(await createSession('me@example.com', config.secret), config.secret)).toBeNull()
  })

  it('computes the RFC 7636 PKCE challenge', async () => {
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    )
  })
})

describe('google id token', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'k', alg: 'RS256' }] })
  const sign = (claims: Record<string, unknown>, overrides: { iss?: string; aud?: string } = {}) =>
    new SignJWT({ email: 'Me@Example.com', email_verified: true, nonce: 'n', ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: 'k' })
      .setIssuer(overrides.iss ?? 'https://accounts.google.com')
      .setAudience(overrides.aud ?? 'client-id')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey)

  it('accepts the allowed, verified email', async () => {
    expect(await verifyGoogleIdToken(await sign({}), config, 'n', keys)).toBe('me@example.com')
  })

  it('rejects another email, an unverified email, a wrong nonce, audience or issuer', async () => {
    expect(await verifyGoogleIdToken(await sign({ email: 'else@example.com' }), config, 'n', keys)).toBeNull()
    expect(await verifyGoogleIdToken(await sign({ email_verified: false }), config, 'n', keys)).toBeNull()
    expect(await verifyGoogleIdToken(await sign({}), config, 'other', keys)).toBeNull()
    expect(await verifyGoogleIdToken(await sign({}, { aud: 'someone-else' }), config, 'n', keys)).toBeNull()
    expect(await verifyGoogleIdToken(await sign({}, { iss: 'https://evil.example' }), config, 'n', keys)).toBeNull()
  })
})
