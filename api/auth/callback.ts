import {
  callbackUrl,
  cookie,
  createSession,
  getCookie,
  GOOGLE_TOKEN_URL,
  OAUTH_COOKIE,
  openOAuthState,
  readConfig,
  redirect,
  SESSION_COOKIE,
  SESSION_DAYS,
  verifyGoogleIdToken,
} from '../_lib/auth.js'

const clearOAuth = cookie(OAUTH_COOKIE, '', 0)

export async function GET(request: Request): Promise<Response> {
  const config = readConfig()
  if (!config) return redirect('/login?error=setup', [clearOAuth])

  const params = new URL(request.url).searchParams
  const code = params.get('code')
  const sealed = getCookie(request, OAUTH_COOKIE)
  const oauth = sealed ? await openOAuthState(sealed, config.secret) : null
  if (!code || !oauth || params.get('state') !== oauth.state) return redirect('/login?error=failed', [clearOAuth])

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: callbackUrl(request),
      grant_type: 'authorization_code',
      code_verifier: oauth.verifier,
    }),
  }).catch(() => null)
  if (!response?.ok) return redirect('/login?error=failed', [clearOAuth])

  const { id_token: idToken } = (await response.json().catch(() => ({}))) as { id_token?: unknown }
  if (typeof idToken !== 'string') return redirect('/login?error=failed', [clearOAuth])

  const email = await verifyGoogleIdToken(idToken, config, oauth.nonce)
  if (!email) return redirect('/login?error=denied', [clearOAuth])

  const session = await createSession(email, config.secret)
  return redirect('/', [clearOAuth, cookie(SESSION_COOKIE, session, SESSION_DAYS * 86_400)])
}
