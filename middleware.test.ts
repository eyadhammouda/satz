import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSession, readSessionConfig, SESSION_COOKIE } from './api/_lib/auth.js'
import middleware from './middleware.js'

const env = { ALLOWED_EMAIL: 'me@example.com', SESSION_SECRET: 'x'.repeat(48) }
const saved = { ...process.env }

beforeEach(() => Object.assign(process.env, env))
afterEach(() => {
  process.env = { ...saved }
})

const get = (path: string, cookie?: string) =>
  middleware(new Request(`https://satz.test${path}`, cookie ? { headers: { cookie } } : {}))
const passes = (response: Response) => response.headers.get('x-middleware-next') === '1'

describe('middleware', () => {
  it('lets the login page, its assets and the auth endpoints through', async () => {
    for (const path of ['/login', '/login.js', '/favicon.svg', '/apple-touch-icon.png', '/api/auth/login', '/api/auth/callback?code=1']) {
      expect(passes(await get(path)), path).toBe(true)
    }
  })

  it('sends a visitor without a session to the login page', async () => {
    const response = await get('/')
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/login')
  })

  it('hides the app code and every other path from a visitor without a session', async () => {
    for (const path of ['/index.html', '/assets/index-abc.js', '/assets/index-abc.css', '/anything']) {
      const response = await get(path)
      expect(response.status, path).toBe(404)
      expect(passes(response)).toBe(false)
    }
  })

  it('rejects a session for someone else', async () => {
    const token = await createSession('else@example.com', readSessionConfig()!.secret)
    expect((await get('/', `${SESSION_COOKIE}=${token}`)).status).toBe(302)
  })

  it('lets the owner through everywhere', async () => {
    const token = await createSession('me@example.com', readSessionConfig()!.secret)
    for (const path of ['/', '/assets/index-abc.js', '/index.html']) {
      expect(passes(await get(path, `${SESSION_COOKIE}=${token}`)), path).toBe(true)
    }
  })

  it('locks everything when the settings are missing', async () => {
    delete process.env.SESSION_SECRET
    const token = await createSession('me@example.com', new TextEncoder().encode('x'.repeat(48)))
    expect((await get('/', `${SESSION_COOKIE}=${token}`)).status).toBe(302)
  })
})
