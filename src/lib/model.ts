import type { PersonalModel, Progress } from './lesson'

/** Refit after this many new answers, at most once a week, once there are enough to learn from. */
export const MIN_REVIEWS = 200
export const REFIT_AFTER = 300
export const REFIT_DAYS = 7

export function needsFit(progress: Progress, now: number): boolean {
  const count = progress.reviews.length
  if (count < MIN_REVIEWS) return false
  const m = progress.model
  if (!m) return true
  return count - m.reviews >= REFIT_AFTER && now - m.fitted >= REFIT_DAYS * 86_400_000
}

/** Fits the learner's memory model on the server. Returns null when it cannot (offline, too little data). */
export async function fitModel(progress: Progress, now: number): Promise<PersonalModel | null> {
  try {
    const response = await fetch('/api/optimize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviews: progress.reviews, offsetMinutes: -new Date(now).getTimezoneOffset() }),
    })
    if (!response.ok) return null
    const r = (await response.json()) as { parameters: number[]; logLoss: number; defaultLogLoss: number; reviews: number }
    // Keep the defaults when the personal fit does not predict better.
    if (!(r.logLoss <= r.defaultLogLoss)) return null
    return { parameters: r.parameters, fitted: now, reviews: r.reviews, logLoss: r.logLoss, defaultLogLoss: r.defaultLogLoss }
  } catch {
    return null
  }
}
