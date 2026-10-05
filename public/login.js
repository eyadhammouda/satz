// Shows why the last sign-in did not work. Kept outside the HTML so the content security policy can block inline scripts.
const messages = {
  denied: 'This account does not have access.',
  failed: 'Sign-in did not complete. Try again.',
  setup: 'Sign-in is not set up yet.',
}
const error = new URLSearchParams(location.search).get('error')
if (error && messages[error]) document.getElementById('error').textContent = messages[error]
