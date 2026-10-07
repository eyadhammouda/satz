import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MIN_REVIEWS, POST, toItems } from '../optimize.js'
import { createSession, readSessionConfig, SESSION_COOKIE } from './auth.js'

const env = { ALLOWED_EMAIL: 'me@example.com', SESSION_SECRET: 'x'.repeat(48) }
const saved = { ...process.env }
beforeEach(() => Object.assign(process.env, env))
afterEach(() => {
  process.env = { ...saved }
})

const DAY = 86_400_000
const dayOf = (ms: number) => Math.floor(ms / DAY)

/** A learner who reviews 120 sentences on growing intervals, missing about one in six. */
function history(): [number, number, 1 | 3][] {
  let seed = 3
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const out: [number, number, 1 | 3][] = []
  for (let s = 0; s < 120; s++) {
    let at = s * 3600_000
    out.push([s, at, 3])
    let gap = 1
    for (let r = 0; r < 4; r++) {
      at += gap * DAY
      const pass = rand() < 0.85
      out.push([s, at, pass ? 3 : 1])
      gap = pass ? gap * 3 : 1
    }
  }
  return out
}

async function post(body: unknown, signedIn = true) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (signedIn) headers.cookie = `${SESSION_COOKIE}=${await createSession('me@example.com', readSessionConfig()!.secret)}`
  return POST(new Request('https://satz.test/api/optimize', { method: 'POST', headers, body: JSON.stringify(body) }))
}

describe('toItems', () => {
  it('builds one item per repeat review, with days between reviews', () => {
    const items = toItems(
      [
        [7, 0, 3],
        [7, 60_000, 3],
        [7, 2 * DAY, 1],
        [8, DAY, 3],
      ],
      dayOf,
    )
    expect(items.map((i) => i.reviews.map((r) => [r.rating, r.deltaT]))).toEqual([
      [
        [3, 0],
        [3, 0],
      ],
      [
        [3, 0],
        [3, 0],
        [1, 2],
      ],
    ])
  })
})

describe('/api/optimize', () => {
  it('fits personal parameters that predict the answers at least as well as the defaults', async () => {
    const response = await post({ reviews: history(), offsetMinutes: 0 })
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.parameters).toHaveLength(21)
    expect(result.parameters.every((p: number) => Number.isFinite(p))).toBe(true)
    expect(result.logLoss).toBeLessThanOrEqual(result.defaultLogLoss + 1e-6)
    expect(result.reviews).toBe(600)
  }, 30_000)

  it('refuses without a session, with too few reviews, and with bad input', async () => {
    expect((await post({ reviews: history() }, false)).status).toBe(404)
    expect((await post({ reviews: history().slice(0, MIN_REVIEWS - 1) })).status).toBe(422)
    expect((await post({ reviews: 'nope' })).status).toBe(422)
    const bad = await POST(
      new Request('https://satz.test/api/optimize', {
        method: 'POST',
        headers: { cookie: `${SESSION_COOKIE}=${await createSession('me@example.com', readSessionConfig()!.secret)}` },
        body: '{',
      }),
    )
    expect(bad.status).toBe(400)
  })
})
