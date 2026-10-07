import { computeParameters, FSRSBinding, FSRSBindingItem, FSRSBindingReview } from '@open-spaced-repetition/binding'
import { hasValidSession, readSessionConfig } from './_lib/auth.js'

/** Fewer reviews than this give the optimizer too little to learn from. */
export const MIN_REVIEWS = 200
const MAX_REVIEWS = 100_000

export interface OptimizeResult {
  parameters: number[]
  /** How well the personal parameters predict the learner's answers, against the defaults. Lower is better. */
  logLoss: number
  defaultLogLoss: number
  reviews: number
}

type Review = [position: number, at: number, grade: 1 | 3]

/**
 * Turns the review log into FSRS training items: for each sentence, every review after
 * the first becomes an item holding that sentence's history so far, with days between reviews.
 * Reviews on the same day count as 0 days apart, as FSRS expects for short-term steps.
 */
export function toItems(reviews: Review[], dayOf: (ms: number) => number): FSRSBindingItem[] {
  const bySentence = new Map<number, Review[]>()
  for (const r of [...reviews].sort((a, b) => a[1] - b[1])) {
    const list = bySentence.get(r[0]) ?? []
    list.push(r)
    bySentence.set(r[0], list)
  }
  const items: FSRSBindingItem[] = []
  for (const list of bySentence.values()) {
    const history: FSRSBindingReview[] = []
    let lastDay = dayOf(list[0][1])
    for (const [, at, grade] of list) {
      const day = dayOf(at)
      history.push(new FSRSBindingReview(grade, history.length === 0 ? 0 : day - lastDay))
      lastDay = day
      if (history.length > 1) items.push(new FSRSBindingItem([...history]))
    }
  }
  return items
}

/** Fits FSRS to the signed-in learner's own answers. The browser sends its review log and keeps the result. */
export async function POST(request: Request): Promise<Response> {
  if (!(await hasValidSession(request, readSessionConfig()))) return new Response('Not found', { status: 404 })

  let body: { reviews?: unknown; offsetMinutes?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return Response.json({ error: 'Bad request' }, { status: 400 })
  }
  const offset = typeof body.offsetMinutes === 'number' ? body.offsetMinutes : 0
  const reviews = Array.isArray(body.reviews)
    ? (body.reviews as unknown[]).filter(
        (r): r is Review =>
          Array.isArray(r) && Number.isInteger(r[0]) && Number.isFinite(r[1]) && (r[2] === 1 || r[2] === 3),
      )
    : []
  if (reviews.length > MAX_REVIEWS) return Response.json({ error: 'Too many reviews' }, { status: 413 })
  if (reviews.length < MIN_REVIEWS) {
    return Response.json({ error: `Needs at least ${MIN_REVIEWS} reviews`, reviews: reviews.length }, { status: 422 })
  }

  // Study days start at 04:00 local time, like the app's.
  const dayOf = (ms: number) => Math.floor((ms - offset * 60_000 - 4 * 3_600_000) / 86_400_000)
  const items = toItems(reviews, dayOf)
  if (items.length === 0) return Response.json({ error: 'No repeated reviews yet' }, { status: 422 })

  const parameters = await computeParameters(items, { enableShortTerm: true, numRelearningSteps: 1, timeout: 20_000 })
  const result: OptimizeResult = {
    parameters,
    logLoss: new FSRSBinding(parameters).evaluate(items).logLoss,
    defaultLogLoss: new FSRSBinding().evaluate(items).logLoss,
    reviews: reviews.length,
  }
  return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
}
