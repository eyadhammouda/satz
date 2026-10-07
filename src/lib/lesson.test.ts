import { State } from 'ts-fsrs'
import { describe, expect, it } from 'vitest'
import {
  emptyProgress,
  endLesson,
  FIRST_TEST_MS,
  introduce,
  MAX_OPEN,
  NEW_CUTOFF_MS,
  NEW_HARD_CAP,
  nextStep,
  recordAnswer,
  resumeOrStart,
  startLesson,
  WARMUP_MS,
  type Progress,
  type Step,
} from './lesson'
import { ping } from './timer'

const TOTAL = 1000
const MIN = 60_000
const DAY = 86_400_000

/** Answers whatever comes next, with `pass` deciding each answer. Keeps the clock active. */
function run(progress: Progress, start: number, minutes: number, pass: (step: Step) => boolean = () => true) {
  let p = progress
  let now = start
  const steps: Step[] = []
  while (now < start + minutes * MIN) {
    const step = nextStep(p, TOTAL, now)
    steps.push(step)
    if (step.kind === 'done') break
    now += 20_000
    p = step.kind === 'intro' ? introduce(p, now) : recordAnswer(p, step.index, pass(step), step.reason, now)
  }
  return { p, now, steps }
}

describe('a first lesson', () => {
  it('starts with a new sentence and tests it about a minute later', () => {
    let p = startLesson(emptyProgress(), 0)
    expect(nextStep(p, TOTAL, 0)).toEqual({ kind: 'intro', index: 0 })
    p = introduce(p, 0)
    expect(p.cards[0].due).toBe(FIRST_TEST_MS)
    expect(p.next).toBe(1)
    expect(nextStep(p, TOTAL, 10_000)).toEqual({ kind: 'intro', index: 1 })
    // Once due, the learning sentence comes before anything new.
    expect(nextStep(p, TOTAL, FIRST_TEST_MS)).toMatchObject({ kind: 'test', index: 0, reason: 'learning' })
  })

  it('keeps at most MAX_OPEN sentences in learning at once', () => {
    let p = startLesson(emptyProgress(), 0)
    for (let i = 0; i < MAX_OPEN; i++) p = introduce(p, i * 1000)
    expect(nextStep(p, TOTAL, 10_000)).toMatchObject({ kind: 'test', reason: 'learning', index: 0 })
  })

  it('graduates a sentence after passing its 1 and 10 minute steps', () => {
    let p = startLesson(emptyProgress(), 0)
    p = introduce(p, 0)
    p = recordAnswer(p, 0, true, 'learning', MIN)
    expect(p.cards[0].state).toBe(State.Learning)
    expect(p.cards[0].due).toBe(11 * MIN)
    p = recordAnswer(p, 0, true, 'learning', 11 * MIN)
    expect(p.cards[0].state).toBe(State.Review)
    expect(p.cards[0].due).toBeGreaterThanOrEqual(11 * MIN + DAY)
  })

  it('brings a missed sentence back within minutes', () => {
    let p = startLesson(emptyProgress(), 0)
    p = introduce(p, 0)
    p = recordAnswer(p, 0, false, 'learning', MIN)
    expect(p.cards[0].due).toBe(2 * MIN)
    expect(p.lesson!.firstTry).toEqual({ 0: false })
    p = recordAnswer(p, 0, true, 'learning', 2 * MIN)
    expect(p.lesson!.firstTry).toEqual({ 0: false })
  })

  it('fills a full hour with many new sentences, stopping new ones near the end', () => {
    const { p, steps } = run(startLesson(emptyProgress(), 0), 0, 61)
    const intros = steps.filter((s) => s.kind === 'intro').length
    expect(intros).toBeGreaterThanOrEqual(20)
    expect(intros).toBeLessThanOrEqual(NEW_HARD_CAP)
    expect(steps.at(-1)).toEqual({ kind: 'done', why: 'time' })
    // Every sentence introduced was tested at least twice in the lesson.
    const tests = steps.filter((s) => s.kind === 'test')
    for (const index of p.lesson!.introduced.slice(0, -MAX_OPEN)) {
      expect(tests.filter((s) => s.kind === 'test' && s.index === index).length).toBeGreaterThanOrEqual(2)
    }
  })

  it('gives sentences learned this lesson a final pass that does not reschedule them', () => {
    const { p, steps } = run(startLesson(emptyProgress(), 0), 0, 61)
    const finals = steps.filter((s) => s.kind === 'test' && s.reason === 'final')
    expect(finals.length).toBeGreaterThan(0)
    const first = finals[0] as Extract<Step, { kind: 'test' }>
    expect(p.lesson!.passes[first.index]).toBeGreaterThanOrEqual(1)
    expect(p.cards[first.index].state).toBe(State.Review)
  })
})

describe('the next day', () => {
  function afterOneLesson() {
    const { p, now } = run(startLesson(emptyProgress(), 0), 0, 61)
    return { p: endLesson(p, now), learned: p.next }
  }

  it('opens with due reviews and mixes new sentences in after the warm-up', () => {
    const { p: done } = afterOneLesson()
    // FSRS brings a newly learned sentence back after a few days.
    const start = 5 * DAY
    const { steps } = run(startLesson(done, start), start, 61)
    expect(steps[0]).toMatchObject({ kind: 'test', reason: 'review' })
    const firstIntro = steps.findIndex((s) => s.kind === 'intro')
    expect(firstIntro).toBeGreaterThan(0)
    // At 20 seconds per answer, the warm-up lasts this many steps.
    expect(firstIntro).toBeGreaterThanOrEqual(Math.floor(WARMUP_MS / 20_000) - 1)
  })

  it('introduces nothing when reviews would not fit, so backlogs clear first', () => {
    let p = startLesson(emptyProgress(), 0)
    // 200 overdue reviews take longer than an hour.
    for (let i = 0; i < 200; i++) {
      p = introduce(p, 0)
      p = recordAnswer(p, i, true, 'learning', 0)
      p = recordAnswer(p, i, true, 'learning', 0)
    }
    p = endLesson(p, 0)
    const start = 30 * DAY
    let lesson = startLesson(p, start)
    lesson = { ...lesson, lesson: { ...lesson.lesson!, clock: ping({ activeMs: WARMUP_MS + MIN, lastActive: null }, start), sinceNew: 10 } }
    expect(nextStep(lesson, TOTAL, start)).toMatchObject({ kind: 'test', reason: 'review' })
  })

  it('stops new sentences after the cut-off and practises what was learned', () => {
    let p = startLesson(emptyProgress(), 0)
    p = introduce(p, 0)
    p = recordAnswer(p, 0, true, 'learning', MIN)
    p = recordAnswer(p, 0, true, 'learning', 11 * MIN)
    p = { ...p, lesson: { ...p.lesson!, clock: { activeMs: NEW_CUTOFF_MS + MIN, lastActive: 11 * MIN } } }
    p = { ...p, lesson: { ...p.lesson!, introduced: [0, ...Array.from({ length: NEW_HARD_CAP }, (_, i) => i + 1)] } }
    expect(nextStep(p, TOTAL, 11 * MIN)).toMatchObject({ kind: 'test', index: 0, reason: 'final' })
  })

  it('ends when the course runs out', () => {
    const p = startLesson({ ...emptyProgress(), next: TOTAL }, 0)
    expect(nextStep(p, TOTAL, 0)).toEqual({ kind: 'done', why: 'empty' })
  })
})

describe('lesson records', () => {
  it('summarises a finished lesson', () => {
    let p = startLesson(emptyProgress(), 0)
    p = introduce(p, 0)
    p = recordAnswer(p, 0, false, 'learning', MIN)
    p = introduce(p, MIN + 10_000)
    p = recordAnswer(p, 1, true, 'learning', 2 * MIN)
    p = endLesson(p, 2 * MIN)
    expect(p.lesson).toBeNull()
    expect(p.history[0]).toMatchObject({ introduced: 2, reviewed: 2, firstTryCorrect: 1, activeMs: 2 * MIN })
  })
})

describe('resumeOrStart', () => {
  it('carries on an unfinished lesson, even on a later day', () => {
    const open = introduce(startLesson(emptyProgress(), 0), 0)
    expect(resumeOrStart(open, 5 * MIN)).toBe(open)
    expect(resumeOrStart(open, 3 * DAY)).toBe(open)
  })

  it('starts a lesson when none is open', () => {
    expect(resumeOrStart(emptyProgress(), 0).lesson?.started).toBe(0)
  })
})

describe('learned positions', () => {
  it('skips course positions already learned, for example carried over from an earlier course', () => {
    const learned = introduce(startLesson(emptyProgress(), 0), 0).cards[0]
    let p: Progress = startLesson({ ...emptyProgress(), cards: { 0: learned, 2: learned } }, 0)
    expect(nextStep(p, TOTAL, 0)).toEqual({ kind: 'intro', index: 1 })
    p = introduce(p, 0)
    expect(p.next).toBe(3)
    expect(Object.keys(p.cards).sort()).toEqual(['0', '1', '2'])
  })

  it('logs every graded answer, but not a passed final pass', () => {
    let p = startLesson(emptyProgress(), 0)
    p = introduce(p, 0)
    p = recordAnswer(p, 0, false, 'learning', MIN)
    p = recordAnswer(p, 0, true, 'learning', 2 * MIN)
    p = recordAnswer(p, 0, true, 'final', 3 * MIN)
    expect(p.reviews).toEqual([
      [0, MIN, 1],
      [0, 2 * MIN, 3],
    ])
  })
})
