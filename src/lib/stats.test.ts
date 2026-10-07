import { describe, expect, it } from 'vitest'
import { emptyProgress, endLesson, introduce, recordAnswer, startLesson } from './lesson'
import { computeStats } from './stats'

const MIN = 60_000
const DAY = 86_400_000
const START = new Date(2026, 9, 6, 18, 0).getTime()

describe('computeStats', () => {
  it('starts empty', () => {
    const s = computeStats(emptyProgress(), START)
    expect(s).toMatchObject({ learned: 0, remembered: 0, accuracy: null, streak: 0, dueTomorrow: 0 })
    expect(s.minutes).toHaveLength(14)
  })

  it('counts learned sentences, accuracy, minutes and the streak', () => {
    let p = emptyProgress()
    for (let d = 0; d < 3; d++) {
      const at = START + d * DAY
      p = startLesson(p, at)
      p = introduce(p, at)
      p = recordAnswer(p, p.next - 1, d !== 1, 'learning', at + MIN)
      p = recordAnswer(p, p.next - 1, true, 'learning', at + 11 * MIN)
      p = { ...p, lesson: { ...p.lesson!, clock: { activeMs: 20 * MIN, lastActive: at + 11 * MIN } } }
      p = endLesson(p, at + 20 * MIN)
    }
    const s = computeStats(p, START + 2 * DAY + 30 * MIN)
    expect(s.learned).toBe(3)
    expect(s.accuracy).toBeCloseTo(2 / 3)
    // 20 minutes counted, plus up to 2 idle minutes before the lesson closed.
    expect(s.minutes.at(-1)?.day).toBe('2026-10-08')
    expect(s.minutes.at(-1)?.minutes).toBeGreaterThanOrEqual(20)
    expect(s.minutes.at(-4)?.minutes).toBe(0)
    expect(s.streak).toBe(3)
    expect(s.remembered).toBeGreaterThan(0.85)
    expect(s.strength.fresh).toBe(3)
    expect(s.dueTomorrow).toBeGreaterThanOrEqual(1)
  })

  it('keeps the streak until a day is missed', () => {
    let p = startLesson(emptyProgress(), START)
    p = endLesson({ ...p, lesson: { ...p.lesson!, clock: { activeMs: MIN, lastActive: START } } }, START + MIN)
    expect(computeStats(p, START + DAY).streak).toBe(1)
    expect(computeStats(p, START + 2 * DAY).streak).toBe(0)
  })
})
