import type { Sentence } from './types'

/** Study days run from 04:00 to 04:00 local time. */
export const DAY_START_HOUR = 4

/** Days until the next review, indexed by box. */
export const INTERVALS = [1, 3, 7, 14, 30, 60] as const
export const MAX_BOX = INTERVALS.length - 1

const pad = (n: number) => String(n).padStart(2, '0')

/** The study day for a moment in time, as YYYY-MM-DD in local time. */
export function studyDay(now: Date = new Date()): string {
  const shifted = new Date(now.getTime())
  shifted.setHours(shifted.getHours() - DAY_START_HOUR)
  return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}-${pad(shifted.getDate())}`
}

// Pure calendar arithmetic on YYYY-MM-DD strings. UTC is used only so that
// daylight saving changes cannot shift the result; it never decides "today".
function dayToUTC(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

export function addDays(day: string, days: number): string {
  const date = new Date(dayToUTC(day) + days * 86_400_000)
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

export function daysBetween(from: string, to: string): number {
  return Math.round((dayToUTC(to) - dayToUTC(from)) / 86_400_000)
}

export function isDue(sentence: Sentence, today: string): boolean {
  return sentence.dueDay <= today
}

export function createSentence(german: string, english: string, today: string): Sentence {
  return {
    id: crypto.randomUUID(),
    german: german.trim(),
    english: english.trim(),
    createdDay: today,
    box: 0,
    dueDay: addDays(today, 1),
    lastReviewedDay: null,
    correct: 0,
    missed: 0,
  }
}

export function gradeCorrect(sentence: Sentence, today: string): Sentence {
  const box = Math.min(sentence.box + 1, MAX_BOX)
  return {
    ...sentence,
    box,
    dueDay: addDays(today, INTERVALS[box]),
    lastReviewedDay: today,
    correct: sentence.correct + 1,
  }
}

export function gradeMissed(sentence: Sentence, today: string): Sentence {
  return {
    ...sentence,
    box: 0,
    dueDay: addDays(today, 1),
    lastReviewedDay: today,
    missed: sentence.missed + 1,
  }
}

export type Outcome = 'correct' | 'missed'

export interface Session {
  /** Ids still to answer. The front is the current sentence. */
  queue: string[]
  total: number
  /** First-attempt outcome per id, true when correct */
  firstTry: Record<string, boolean>
}

export function startSession(ids: string[]): Session {
  return { queue: [...ids], total: ids.length, firstTry: {} }
}

/**
 * Records an answer to the current sentence. A missed sentence goes to the
 * back of the queue and repeats until it is answered correctly once.
 * Only the first attempt should change the schedule.
 */
export function answer(session: Session, outcome: Outcome): { session: Session; firstAttempt: boolean } {
  const [id, ...rest] = session.queue
  if (id === undefined) return { session, firstAttempt: false }
  const firstAttempt = !(id in session.firstTry)
  return {
    firstAttempt,
    session: {
      ...session,
      queue: outcome === 'correct' ? rest : [...rest, id],
      firstTry: firstAttempt ? { ...session.firstTry, [id]: outcome === 'correct' } : session.firstTry,
    },
  }
}

export function completedCount(session: Session): number {
  return session.total - session.queue.length
}

export function firstTryCorrectCount(session: Session): number {
  return Object.values(session.firstTry).filter(Boolean).length
}

export function shuffle<T>(items: T[]): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}
