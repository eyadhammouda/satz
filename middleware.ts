import { next } from '@vercel/functions'
import { hasValidSession, readSessionConfig } from './api/_lib/auth.js'

// Everything else, including the app's code, needs a session.
export const PUBLIC_PATHS = new Set(['/login', '/login.html', '/login.js', '/favicon.svg', '/apple-touch-icon.png', '/robots.txt'])

export default async function middleware(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url)
  if (PUBLIC_PATHS.has(pathname) || pathname.startsWith('/api/auth/')) return next()

  if (await hasValidSession(request, readSessionConfig())) return next()

  if (request.method === 'GET' && pathname === '/') {
    return new Response(null, { status: 302, headers: { Location: '/login', 'Cache-Control': 'no-store' } })
  }
  return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })
}
