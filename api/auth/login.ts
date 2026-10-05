import {
  cookie,
  googleAuthUrl,
  OAUTH_COOKIE,
  pkceChallenge,
  randomToken,
  readConfig,
  redirect,
  sealOAuthState,
} from '../_lib/auth.js'

export async function GET(request: Request): Promise<Response> {
  const config = readConfig()
  if (!config) return redirect('/login?error=setup')

  const oauth = { state: randomToken(), verifier: randomToken(), nonce: randomToken() }
  const sealed = await sealOAuthState(oauth, config.secret)
  const challenge = await pkceChallenge(oauth.verifier)
  return redirect(googleAuthUrl(request, config, oauth, challenge), [cookie(OAUTH_COOKIE, sealed, 600)])
}
