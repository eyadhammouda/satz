import { describe, expect, it } from 'vitest'
import {
  addDays,
  answer,
  completedCount,
  createSentence,
  daysBetween,
  firstTryCorrectCount,
  gradeCorrect,
  gradeMissed,
  INTERVALS,
  isDue,
  startSession,
  studyDay,
} from './schedule'

describe('studyDay', () => {
  it('returns the previous calendar date at 02:00 local time', () => {
    expect(studyDay(new Date(2026, 9, 5, 2, 0))).toBe('2026-10-04')
  })

  it('returns the previous date at 03:59 and the same date at 04:00', () => {
    expect(studyDay(new Date(2026, 9, 5, 3, 59))).toBe('2026-10-04')
    expect(studyDay(new Date(2026, 9, 5, 4, 0))).toBe('2026-10-05')
  })

  it('returns the same date late in the evening', () => {
    expect(studyDay(new Date(2026, 9, 5, 23, 59))).toBe('2026-10-05')
  })

  it('crosses month and year boundaries', () => {
    expect(studyDay(new Date(2026, 0, 1, 1, 30))).toBe('2025-12-31')
    expect(studyDay(new Date(2026, 2, 1, 0, 0))).toBe('2026-02-28')
  })
})

describe('day arithmetic', () => {
  it('adds days across months, years and leap days', () => {
    expect(addDays('2026-10-05', 1)).toBe('2026-10-06')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2026-10-05', 60)).toBe('2026-12-04')
  })

  it('counts days between two study days', () => {
    expect(daysBetween('2026-10-05', '2026-10-08')).toBe(3)
    expect(daysBetween('2026-10-05', '2026-10-04')).toBe(-1)
  })
})

describe('grading', () => {
  const today = '2026-10-05'

  it('creates new sentences in box 0, due the next study day', () => {
    const s = createSentence('  Lass mich mal sehen ', ' Let me see it ', today)
    expect(s).toMatchObject({
      german: 'Lass mich mal sehen',
      english: 'Let me see it',
      createdDay: today,
      box: 0,
      dueDay: '2026-10-06',
      lastReviewedDay: null,
      correct: 0,
      missed: 0,
    })
  })

  it('is due on or after dueDay', () => {
    const s = createSentence('a', 'b', today)
    expect(isDue(s, today)).toBe(false)
    expect(isDue(s, '2026-10-06')).toBe(true)
    expect(isDue(s, '2026-10-20')).toBe(true)
  })

  it('moves a correct sentence from box 0 to box 1, due in 3 days', () => {
    const s = gradeCorrect(createSentence('a', 'b', '2026-10-04'), today)
    expect(s.box).toBe(1)
    expect(s.dueDay).toBe('2026-10-08')
    expect(s.correct).toBe(1)
    expect(s.lastReviewedDay).toBe(today)
  })

  it('follows the interval for every box and stops at box 5', () => {
    let s = createSentence('a', 'b', today)
    for (let box = 1; box <= 5; box++) {
      s = gradeCorrect(s, today)
      expect(s.box).toBe(box)
      expect(s.dueDay).toBe(addDays(today, INTERVALS[box]))
    }
    s = gradeCorrect(s, today)
    expect(s.box).toBe(5)
    expect(s.dueDay).toBe(addDays(today, 60))
  })

  it('sends a missed sentence back to box 0, due the next study day', () => {
    const s = gradeMissed({ ...createSentence('a', 'b', today), box: 4 }, today)
    expect(s.box).toBe(0)
    expect(s.dueDay).toBe('2026-10-06')
    expect(s.missed).toBe(1)
    expect(s.lastReviewedDay).toBe(today)
  })
})

describe('session', () => {
  it('repeats a missed sentence at the back until it is answered correctly', () => {
    let session = startSession(['a', 'b', 'c'])

    let r = answer(session, 'missed')
    expect(r.firstAttempt).toBe(true)
    session = r.session
    expect(session.queue).toEqual(['b', 'c', 'a'])

    session = answer(session, 'correct').session
    session = answer(session, 'correct').session
    expect(session.queue).toEqual(['a'])

    r = answer(session, 'missed')
    expect(r.firstAttempt).toBe(false)
    session = r.session
    expect(session.queue).toEqual(['a'])

    r = answer(session, 'correct')
    expect(r.firstAttempt).toBe(false)
    session = r.session
    expect(session.queue).toEqual([])
    expect(completedCount(session)).toBe(3)
    expect(firstTryCorrectCount(session)).toBe(2)
    expect(session.firstTry).toEqual({ a: false, b: true, c: true })
  })

  it('ignores answers once the queue is empty', () => {
    const session = startSession([])
    expect(answer(session, 'correct')).toEqual({ session, firstAttempt: false })
  })
})
