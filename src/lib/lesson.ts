import { createEmptyCard, fsrs, Rating, State, type Card, type FSRS } from 'ts-fsrs'
import { elapsed, LESSON_MS, newClock, ping, type Clock } from './timer'

/**
 * The learning plan for one 30-minute lesson, built on the research summarised in CLAUDE.md:
 * - Each new sentence is shown with its audio first, then tested after about
 *   1 minute and 10 minutes (learning steps), then scheduled by FSRS.
 * - Due reviews come first, the most likely to be forgotten first. New sentences
 *   are mixed in once the lesson is warm, so reviews never squeeze out learning.
 * - New sentences stop 10 minutes before the end, so their 10-minute step fits in
 *   the lesson, and the last minutes go to one more pass over what was learned.
 */

export const NEW_SOFT_CAP = 15
export const NEW_HARD_CAP = 22
/** Sentences being learned at once (introduced but not yet graduated). Glossika uses batches of 5. */
export const MAX_OPEN = 6
export const WARMUP_MS = 5 * 60_000
export const NEW_CUTOFF_MS = 20 * 60_000
export const FINAL_MS = 27 * 60_000
export const LEARN_AHEAD_MS = 10 * 60_000
/** First test after the sentence is shown. */
export const FIRST_TEST_MS = 60_000
/** Rough time for one review, to judge whether due reviews still fit in the lesson. */
export const REVIEW_MS = 25_000
export const REVIEWS_BETWEEN_NEW = 3
/** Reviews of sentences with an interval of at least this many days alternate with listening. */
export const DICTATION_AFTER_DAYS = 21

const SETTINGS = {
  request_retention: 0.9,
  learning_steps: ['1m', '10m'],
  relearning_steps: ['10m'],
  enable_fuzz: true,
  enable_short_term: true,
} as const

export const scheduler = fsrs(SETTINGS)

const personal = new Map<string, FSRS>()

/** The scheduler for this learner: their own fitted parameters when there are any, otherwise the defaults. */
export function schedulerFor(progress: Pick<Progress, 'model'>): FSRS {
  const w = progress.model?.parameters
  if (!w) return scheduler
  const key = w.join(',')
  let f = personal.get(key)
  if (!f) {
    f = fsrs({ ...SETTINGS, w })
    personal.set(key, f)
  }
  return f
}

export interface StoredCard {
  due: number
  stability: number
  difficulty: number
  elapsed_days: number
  scheduled_days: number
  learning_steps: number
  reps: number
  lapses: number
  state: State
  last_review: number | null
  /** When the sentence was first shown. */
  introduced: number
}

export interface Lesson {
  started: number
  clock: Clock
  /** Course positions shown for the first time in this lesson, in order. */
  introduced: number[]
  /** First answer per course position in this lesson. */
  firstTry: Record<string, boolean>
  /** Extra passes per sentence learned this lesson. The first is the end-of-lesson pass. */
  passes: Record<string, number>
  /** Reviews since the last new sentence. */
  sinceNew: number
}

export interface LessonRecord {
  started: number
  ended: number
  activeMs: number
  introduced: number
  reviewed: number
  firstTryCorrect: number
}

/** A sentence learned on an earlier course that is not part of the current one. It keeps being reviewed. */
export interface ExtraSentence {
  tatoebaId: number
  german: string
  english: string
  alternatives: string[]
}

export interface Progress {
  version: 2
  /** The course version this progress is keyed to (see public/sentences/index.json). */
  course: number
  /** Course position of the next sentence to introduce. Positions already in `cards` are skipped. */
  next: number
  cards: Record<string, StoredCard>
  lesson: Lesson | null
  history: LessonRecord[]
  /** German answers the learner marked as right, per course position. */
  accepted: Record<string, string[]>
  /**
   * Sentences from an earlier course, keyed by negative positions (-1, -2, ...) in `cards`,
   * so they keep their review schedule.
   */
  extra: Record<string, ExtraSentence>
  /**
   * Every graded answer, oldest first: [course position, time in ms, 1 for a miss or 3 for a pass].
   * Kept so the FSRS parameters can later be fitted to this learner's own memory.
   */
  reviews: [number, number, 1 | 3][]
  /** FSRS parameters fitted to this learner's answers, see api/optimize.ts. Null until there is enough data. */
  model: PersonalModel | null
}

export interface PersonalModel {
  parameters: number[]
  /** When it was fitted, and on how many reviews. */
  fitted: number
  reviews: number
  /** Prediction error of the personal and default parameters on the learner's answers. Lower is better. */
  logLoss: number
  defaultLogLoss: number
}

/** final: one more pass over today's sentences, which only reschedules a miss. */
export type Reason = 'learning' | 'review' | 'final'
export type Step =
  | { kind: 'intro'; index: number }
  | { kind: 'test'; index: number; reason: Reason; mode: 'type' | 'listen' }
  | { kind: 'done'; why: 'time' | 'empty' }

export const COURSE_VERSION = 2

export const emptyProgress = (): Progress => ({
  version: 2,
  course: COURSE_VERSION,
  next: 0,
  cards: {},
  lesson: null,
  history: [],
  accepted: {},
  extra: {},
  reviews: [],
  model: null,
})

/** The first course position at or after `from` that has not been learned yet. */
export function nextUnlearned(progress: Progress, from = progress.next): number {
  let i = from
  while (i in progress.cards) i++
  return i
}

export function toCard(stored: StoredCard): Card {
  const { introduced: _introduced, last_review, due, ...rest } = stored
  return { ...rest, due: new Date(due), last_review: last_review === null ? undefined : new Date(last_review) }
}

function fromCard(card: Card, introduced: number): StoredCard {
  return {
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review ? card.last_review.getTime() : null,
    introduced,
  }
}

const isLearning = (card: StoredCard) => card.state !== State.Review

/** Opens the lesson to study now: an unfinished lesson carries on where it stopped, whatever the day. */
export function resumeOrStart(progress: Progress, now: number): Progress {
  return progress.lesson ? progress : startLesson(progress, now)
}

export function startLesson(progress: Progress, now: number): Progress {
  return {
    ...progress,
    lesson: { started: now, clock: ping(newClock(), now), introduced: [], firstTry: {}, passes: {}, sinceNew: 0 },
  }
}

export function dueReviewCount(progress: Progress, now: number): number {
  return Object.values(progress.cards).filter((c) => c.state === State.Review && c.due <= now).length
}

/** Decides what to study next. Call it after every answer; it never interrupts a card. */
export function nextStep(progress: Progress, total: number, now: number): Step {
  const lesson = progress.lesson
  if (!lesson) return { kind: 'done', why: 'empty' }
  const t = elapsed(lesson.clock, now)
  if (t >= LESSON_MS) return { kind: 'done', why: 'time' }

  const entries = Object.entries(progress.cards).map(([key, card]) => ({ index: Number(key), card }))
  const learning = entries.filter((e) => isLearning(e.card)).sort((a, b) => a.card.due - b.card.due)
  const dueLearning = learning.find((e) => e.card.due <= now)
  if (dueLearning) return { kind: 'test', index: dueLearning.index, reason: 'learning', mode: 'type' }

  const dueReviews = entries.filter((e) => e.card.state === State.Review && e.card.due <= now)
  const lessonNew = lesson.introduced.length
  const upcoming = nextUnlearned(progress)
  const canIntroduce = upcoming < total && learning.length < MAX_OPEN
  const intro: Step = { kind: 'intro', index: upcoming }

  if (dueReviews.length > 0) {
    const reviewsFit = dueReviews.length * REVIEW_MS < LESSON_MS - t
    if (
      canIntroduce &&
      reviewsFit &&
      t >= WARMUP_MS &&
      t < NEW_CUTOFF_MS &&
      lessonNew < NEW_SOFT_CAP &&
      lesson.sinceNew >= REVIEWS_BETWEEN_NEW
    ) {
      return intro
    }
    // The sentence most likely to be forgotten comes first.
    const date = new Date(now)
    const hardest = dueReviews
      .map((e) => ({ ...e, r: schedulerFor(progress).get_retrievability(toCard(e.card), date, false) }))
      .sort((a, b) => a.r - b.r || a.index - b.index)[0]
    const listen = hardest.card.scheduled_days >= DICTATION_AFTER_DAYS && hardest.card.reps % 2 === 0
    return { kind: 'test', index: hardest.index, reason: 'review', mode: listen ? 'listen' : 'type' }
  }

  if (canIntroduce && t < NEW_CUTOFF_MS && lessonNew < NEW_SOFT_CAP) return intro

  // Anki's "learn ahead": rather than wait, test a sentence that is due within a few minutes.
  if (learning[0] && learning[0].card.due - now <= LEARN_AHEAD_MS) {
    return { kind: 'test', index: learning[0].index, reason: 'learning', mode: 'type' }
  }

  const learned = lesson.introduced.filter((i) => progress.cards[i]?.state === State.Review)
  const passes = (i: number) => lesson.passes[i] ?? 0
  const final = learned.find((i) => passes(i) === 0)
  if (final !== undefined) return { kind: 'test', index: final, reason: 'final', mode: 'type' }

  // Nothing is waiting: use the time for more new sentences, up to a hard cap that keeps future reviews manageable.
  if (canIntroduce && t < FINAL_MS && lessonNew < NEW_HARD_CAP) return intro
  if (learning[0]) return { kind: 'test', index: learning[0].index, reason: 'learning', mode: 'type' }
  // Still time left: keep going over this lesson's sentences, the least practised first.
  const extra = [...learned].sort((a, b) => passes(a) - passes(b) || a - b)[0]
  if (extra !== undefined) return { kind: 'test', index: extra, reason: 'final', mode: 'type' }
  return { kind: 'done', why: 'empty' }
}

/** Marks the next course sentence as shown. Its first test comes about a minute later. */
export function introduce(progress: Progress, now: number): Progress {
  const lesson = progress.lesson
  if (!lesson) return progress
  const index = nextUnlearned(progress)
  const card = fromCard({ ...createEmptyCard(new Date(now)), due: new Date(now + FIRST_TEST_MS) }, now)
  return {
    ...progress,
    next: nextUnlearned({ ...progress, cards: { ...progress.cards, [index]: card } }, index + 1),
    cards: { ...progress.cards, [index]: card },
    lesson: { ...lesson, clock: ping(lesson.clock, now), introduced: [...lesson.introduced, index], sinceNew: 0 },
  }
}

/** Records an answer. A pass is FSRS "Good", a miss is "Again". The end-of-lesson pass only reschedules a miss. */
export function recordAnswer(progress: Progress, index: number, pass: boolean, reason: Reason, now: number): Progress {
  const lesson = progress.lesson
  const stored = progress.cards[index]
  if (!lesson || !stored) return progress

  let cards = progress.cards
  let reviews = progress.reviews
  if (!(reason === 'final' && pass)) {
    const { card } = schedulerFor(progress).next(toCard(stored), new Date(now), pass ? Rating.Good : Rating.Again)
    cards = { ...cards, [index]: fromCard(card, stored.introduced) }
    reviews = [...reviews, [index, now, pass ? 3 : 1]]
  }
  const key = String(index)
  return {
    ...progress,
    cards,
    reviews,
    lesson: {
      ...lesson,
      clock: ping(lesson.clock, now),
      firstTry: key in lesson.firstTry ? lesson.firstTry : { ...lesson.firstTry, [key]: pass },
      passes: reason === 'final' ? { ...lesson.passes, [key]: (lesson.passes[key] ?? 0) + 1 } : lesson.passes,
      sinceNew: reason === 'review' ? lesson.sinceNew + 1 : lesson.sinceNew,
    },
  }
}

export function summarise(lesson: Lesson, now: number): LessonRecord {
  const answers = Object.values(lesson.firstTry)
  return {
    started: lesson.started,
    ended: now,
    activeMs: elapsed(lesson.clock, now),
    introduced: lesson.introduced.length,
    reviewed: answers.length,
    firstTryCorrect: answers.filter(Boolean).length,
  }
}

/** Closes the lesson and keeps a short record of it. */
export function endLesson(progress: Progress, now: number): Progress {
  if (!progress.lesson) return progress
  return { ...progress, lesson: null, history: [...progress.history, summarise(progress.lesson, now)].slice(-500) }
}
