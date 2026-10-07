import { State } from 'ts-fsrs'
import { studyDay } from './day'
import { schedulerFor, toCard, type Progress } from './lesson'

export interface Stats {
  /** Sentences learned, which is also words learned: each sentence teaches one. */
  learned: number
  /** Share of learned sentences the model expects you to remember right now, 0 to 1. */
  remembered: number
  /** Learned sentences by how long their memory lasts. */
  strength: { fresh: number; settling: number; strong: number; lasting: number }
  /** First-try accuracy over the last 30 days, 0 to 1, or null with no answers. */
  accuracy: number | null
  /** Minutes studied on each of the last 14 study days, oldest first. */
  minutes: { day: string; minutes: number }[]
  /** Study days in a row up to today (or yesterday, if today has no lesson yet). */
  streak: number
  /** Reviews due tomorrow and over the next 7 days. */
  dueTomorrow: number
  dueWeek: number
}

const DAY = 86_400_000

export function computeStats(progress: Progress, now: number): Stats {
  const scheduler = schedulerFor(progress)
  const cards = Object.values(progress.cards)
  const learned = cards.length
  const date = new Date(now)
  let remembered = 0
  const strength = { fresh: 0, settling: 0, strong: 0, lasting: 0 }
  let dueTomorrow = 0
  let dueWeek = 0
  for (const card of cards) {
    remembered += card.state === State.Review ? scheduler.get_retrievability(toCard(card), date, false) : 0.9
    const s = card.stability
    if (card.state !== State.Review || s < 7) strength.fresh++
    else if (s < 30) strength.settling++
    else if (s < 180) strength.strong++
    else strength.lasting++
    if (card.due <= now + DAY) dueTomorrow++
    if (card.due <= now + 7 * DAY) dueWeek++
  }

  const recent = progress.history.filter((h) => h.started >= now - 30 * DAY)
  const answered = recent.reduce((sum, h) => sum + h.reviewed, 0)
  const correct = recent.reduce((sum, h) => sum + h.firstTryCorrect, 0)

  const byDay = new Map<string, number>()
  const sessions = progress.lesson ? [...progress.history, { started: progress.lesson.started, activeMs: progress.lesson.clock.activeMs }] : progress.history
  for (const h of sessions) byDay.set(studyDay(h.started), (byDay.get(studyDay(h.started)) ?? 0) + h.activeMs)
  const minutes = Array.from({ length: 14 }, (_, i) => {
    const day = studyDay(now - (13 - i) * DAY)
    return { day, minutes: Math.round((byDay.get(day) ?? 0) / 60_000) }
  })

  let streak = 0
  for (let i = byDay.has(studyDay(now)) ? 0 : 1; byDay.has(studyDay(now - i * DAY)); i++) streak++

  return {
    learned,
    remembered: learned ? remembered / learned : 0,
    strength,
    accuracy: answered ? correct / answered : null,
    minutes,
    streak,
    dueTomorrow,
    dueWeek,
  }
}
