import { State } from 'ts-fsrs'
import {
  COURSE_VERSION,
  emptyProgress,
  nextUnlearned,
  type ExtraSentence,
  type Lesson,
  type LessonRecord,
  type PersonalModel,
  type Progress,
  type StoredCard,
} from './lesson'

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
    if (card && Number.isInteger(Number(key))) cards[key] = card
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
  const extra: Record<string, ExtraSentence> = {}
  if (typeof d.extra === 'object' && d.extra !== null) {
    for (const [key, value] of Object.entries(d.extra)) {
      const e = value as Partial<ExtraSentence> | null
      if (e && isCount(e.tatoebaId) && typeof e.german === 'string' && typeof e.english === 'string') {
        extra[key] = {
          tatoebaId: e.tatoebaId,
          german: e.german,
          english: e.english,
          alternatives: Array.isArray(e.alternatives) ? e.alternatives.filter((a) => typeof a === 'string') : [],
        }
      }
    }
  }
  // Progress saved before course versions existed belongs to course 1.
  const course = isCount(d.course) ? d.course : 1
  const reviews = Array.isArray(d.reviews)
    ? (d.reviews as unknown[]).filter(
        (r): r is [number, number, 1 | 3] =>
          Array.isArray(r) && Number.isInteger(r[0]) && isNumber(r[1]) && (r[2] === 1 || r[2] === 3),
      )
    : []
  return { version: 2, course, next: d.next, cards, lesson: parseLesson(d.lesson), history, accepted, extra, reviews, model: parseModel(d.model) }
}

function parseModel(value: unknown): PersonalModel | null {
  const m = value as Partial<PersonalModel> | null
  if (!m || !Array.isArray(m.parameters) || m.parameters.length < 17 || !m.parameters.every(isNumber)) return null
  if (!isNumber(m.fitted) || !isCount(m.reviews) || !isNumber(m.logLoss) || !isNumber(m.defaultLogLoss)) return null
  return { parameters: m.parameters, fitted: m.fitted, reviews: m.reviews, logLoss: m.logLoss, defaultLogLoss: m.defaultLogLoss }
}

/** One row of public/sentences/legacy-v1.json: [new position or -1, tatoeba id, german, english, alternatives?]. */
export type LegacyRow = [position: number, tatoebaId: number, german: string, english: string, alternatives?: string[]]

/**
 * Moves progress from course 1 (ordered by difficulty) onto the current course (one new word per sentence).
 * A learned sentence that is also in the new course keeps its schedule at its new position, so it is not
 * taught again. One that is not keeps its schedule as an extra sentence under a negative position.
 * Nothing learned is lost, and an open lesson carries on with the time it has left.
 */
export function migrateFromCourse1(progress: Progress, legacy: LegacyRow[]): Progress {
  const cards: Record<string, StoredCard> = {}
  const extra: Record<string, ExtraSentence> = {}
  const accepted: Record<string, string[]> = {}
  const moved = new Map<number, number>()
  let nextExtra = -1
  for (const [key, card] of Object.entries(progress.cards)) {
    const old = Number(key)
    const row = legacy[old]
    if (!row) continue
    const [position, tatoebaId, german, english, alternatives] = row
    const target = position >= 0 && !(position in cards) ? position : nextExtra--
    cards[target] = card
    moved.set(old, target)
    if (target < 0) extra[target] = { tatoebaId, german, english, alternatives: alternatives ?? [] }
    if (progress.accepted[old]) accepted[target] = progress.accepted[old]
  }
  const remap = <T,>(record: Record<string, T>) =>
    Object.fromEntries(Object.entries(record).flatMap(([k, v]) => (moved.has(Number(k)) ? [[moved.get(Number(k))!, v]] : [])))
  // An open lesson carries on, with its sentences at their new positions and its clock untouched.
  const lesson = progress.lesson && {
    ...progress.lesson,
    introduced: progress.lesson.introduced.flatMap((i) => (moved.has(i) ? [moved.get(i)!] : [])),
    firstTry: remap(progress.lesson.firstTry),
    passes: remap(progress.lesson.passes),
  }
  const reviews = progress.reviews.flatMap(([old, at, grade]) =>
    moved.has(old) ? [[moved.get(old)!, at, grade] as [number, number, 1 | 3]] : [],
  )
  const migrated: Progress = {
    version: 2,
    course: COURSE_VERSION,
    next: 0,
    cards,
    lesson,
    history: progress.history,
    accepted,
    extra,
    reviews,
    model: null,
  }
  return { ...migrated, next: nextUnlearned(migrated, 0) }
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
