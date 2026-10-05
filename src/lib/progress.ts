import { State } from 'ts-fsrs'
import { emptyProgress, type Lesson, type LessonRecord, type Progress, type StoredCard } from './lesson'

export const PROGRESS_KEY = 'satz.v2'
const BROKEN_KEY = 'satz.v2.unreadable'

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0

function parseCard(value: unknown): StoredCard | null {
  if (typeof value !== 'object' || value === null) return null
  const c = value as Record<string, unknown>
  const numbers = ['due', 'stability', 'difficulty', 'elapsed_days', 'scheduled_days', 'introduced'] as const
  if (!numbers.every((k) => isNumber(c[k]))) return null
  if (!isCount(c.learning_steps) || !isCount(c.reps) || !isCount(c.lapses)) return null
  if (![State.New, State.Learning, State.Review, State.Relearning].includes(c.state as State)) return null
  if (c.last_review !== null && !isNumber(c.last_review)) return null
  return {
    due: c.due as number,
    stability: c.stability as number,
    difficulty: c.difficulty as number,
    elapsed_days: c.elapsed_days as number,
    scheduled_days: c.scheduled_days as number,
    learning_steps: c.learning_steps as number,
    reps: c.reps as number,
    lapses: c.lapses as number,
    state: c.state as State,
    last_review: c.last_review as number | null,
    introduced: c.introduced as number,
  }
}

function parseLesson(value: unknown): Lesson | null {
  if (typeof value !== 'object' || value === null) return null
  const l = value as Record<string, unknown>
  const clock = l.clock as Record<string, unknown> | undefined
  if (!isNumber(l.started) || !clock || !isNumber(clock.activeMs)) return null
  if (clock.lastActive !== null && !isNumber(clock.lastActive)) return null
  if (!Array.isArray(l.introduced) || !l.introduced.every(isCount)) return null
  if (typeof l.firstTry !== 'object' || l.firstTry === null) return null
  if (typeof l.passes !== 'object' || l.passes === null) return null
  return {
    started: l.started,
    clock: { activeMs: clock.activeMs, lastActive: clock.lastActive as number | null },
    introduced: l.introduced as number[],
    firstTry: l.firstTry as Record<string, boolean>,
    passes: l.passes as Record<string, number>,
    sinceNew: isCount(l.sinceNew) ? l.sinceNew : 0,
  }
}

/** Reads stored or imported progress. Throws when it is not Satz progress. */
export function parseProgress(data: unknown): Progress {
  const d = data as Record<string, unknown> | null
  if (!d || d.version !== 2 || !isCount(d.next) || typeof d.cards !== 'object' || d.cards === null) {
    throw new Error('Not Satz progress')
  }
  const cards: Record<string, StoredCard> = {}
  for (const [key, value] of Object.entries(d.cards)) {
    const card = parseCard(value)
    if (card && isCount(Number(key))) cards[key] = card
  }
  const history = Array.isArray(d.history)
    ? (d.history as LessonRecord[]).filter((h) => h && isNumber(h.started) && isNumber(h.activeMs))
    : []
  const accepted: Record<string, string[]> = {}
  if (typeof d.accepted === 'object' && d.accepted !== null) {
    for (const [key, list] of Object.entries(d.accepted)) {
      if (Array.isArray(list)) accepted[key] = list.filter((s): s is string => typeof s === 'string')
    }
  }
  return { version: 2, next: d.next, cards, lesson: parseLesson(d.lesson), history, accepted }
}

export function loadProgress(): Progress {
  let raw: string | null
  try {
    raw = localStorage.getItem(PROGRESS_KEY)
  } catch {
    return emptyProgress()
  }
  if (raw === null) return emptyProgress()
  try {
    return parseProgress(JSON.parse(raw))
  } catch {
    try {
      localStorage.setItem(BROKEN_KEY, raw)
    } catch {
      // Nothing more to do.
    }
    return emptyProgress()
  }
}

export function saveProgress(progress: Progress): boolean {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress))
    return true
  } catch {
    return false
  }
}

export function exportProgress(progress: Progress, day: string): void {
  const blob = new Blob([JSON.stringify(progress)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `satz-progress-${day}.json`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export async function readProgressFile(file: File): Promise<Progress> {
  return parseProgress(JSON.parse(await file.text()))
}
