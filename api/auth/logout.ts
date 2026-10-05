import { cookie, redirect, SESSION_COOKIE } from '../_lib/auth.js'

export function POST(): Response {
  return redirect('/login', [cookie(SESSION_COOKIE, '', 0)])
}
