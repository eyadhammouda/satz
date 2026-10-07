import { describe, expect, it } from 'vitest'
import { emptyProgress, endLesson, introduce, recordAnswer, startLesson, type Progress } from './lesson'
import { migrateFromCourse1, parseProgress, type LegacyRow } from './progress'

describe('progress storage', () => {
  it('round trips a progress with an open lesson and history', () => {
    let p = startLesson(emptyProgress(), 0)
    p = introduce(p, 0)
    p = recordAnswer(p, 0, true, 'learning', 60_000)
    const withHistory = endLesson(startLesson(endLesson(p, 70_000), 80_000), 90_000)
    const open = startLesson(withHistory, 100_000)
    const copy = parseProgress(JSON.parse(JSON.stringify({ ...open, accepted: { 0: ['Ich bin da.'] } })))
    expect(copy).toEqual({ ...open, accepted: { 0: ['Ich bin da.'] } })
  })

  it('drops invalid cards and rejects other data', () => {
    const p = introduce(startLesson(emptyProgress(), 0), 0)
    const data = JSON.parse(JSON.stringify(p))
    data.cards['7'] = { due: 'soon' }
    data.cards.x = data.cards['0']
    expect(Object.keys(parseProgress(data).cards)).toEqual(['0'])
    expect(() => parseProgress({ version: 1, sentences: [] })).toThrow()
    expect(() => parseProgress(null)).toThrow()
  })
})

describe('moving from course 1', () => {
  // Course 1 positions 0 to 3: two are in the new course (at 10 and 4), two are not.
  const legacy: LegacyRow[] = [
    [10, 111, 'Das war ich.', 'That was me.'],
    [-1, 222, 'Du oder ich?', 'You or I?', ['Ihr oder ich?']],
    [4, 333, 'Sie ist hier.', "She's here."],
    [-1, 444, 'Ich will sie.', 'I want them.'],
  ]

  function course1(): Progress {
    let p = startLesson(emptyProgress(), 0)
    for (let i = 0; i < 4; i++) p = introduce(p, i * 1000)
    p = recordAnswer(p, 1, false, 'learning', 60_000)
    p = { ...endLesson(p, 70_000), accepted: { 1: ['Ich oder du?'] } }
    // Saved before course versions existed.
    const { course: _course, extra: _extra, ...old } = p
    return parseProgress(JSON.parse(JSON.stringify(old)))
  }

  it('reads progress saved before course versions as course 1', () => {
    expect(course1().course).toBe(1)
    expect(course1().extra).toEqual({})
  })

  it('keeps every learned sentence and its schedule', () => {
    const old = course1()
    const p = migrateFromCourse1(old, legacy)
    expect(p.course).toBe(2)
    expect(Object.keys(p.cards).map(Number).sort((a, b) => a - b)).toEqual([-2, -1, 4, 10])
    expect(p.cards[10]).toEqual(old.cards[0])
    expect(p.cards[4]).toEqual(old.cards[2])
    expect(p.cards[-1]).toEqual(old.cards[1])
    expect(p.extra[-1]).toEqual({ tatoebaId: 222, german: 'Du oder ich?', english: 'You or I?', alternatives: ['Ihr oder ich?'] })
    expect(p.extra[-2].german).toBe('Ich will sie.')
    expect(p.accepted[-1]).toEqual(['Ich oder du?'])
    expect(p.reviews).toEqual([[-1, 60_000, 1]])
    expect(p.history).toEqual(old.history)
    expect(p.next).toBe(0)
  })

  it('keeps an open lesson going, with its clock and its sentences at their new positions', () => {
    let open = startLesson(emptyProgress(), 0)
    for (let i = 0; i < 3; i++) open = introduce(open, i * 1000)
    open = recordAnswer(open, 0, true, 'learning', 60_000)
    open = recordAnswer(open, 1, false, 'learning', 61_000)
    open = { ...open, lesson: { ...open.lesson!, clock: { activeMs: 19 * 60_000, lastActive: 61_000 } } }
    const p = migrateFromCourse1({ ...open, course: 1 }, legacy)
    expect(p.lesson?.clock).toEqual({ activeMs: 19 * 60_000, lastActive: 61_000 })
    expect(p.lesson?.started).toBe(0)
    expect(p.lesson?.introduced).toEqual([10, -1, 4])
    expect(p.lesson?.firstTry).toEqual({ 10: true, [-1]: false })
    expect(p.history).toEqual([])
  })

  it('round trips migrated progress', () => {
    const p = migrateFromCourse1(course1(), legacy)
    expect(parseProgress(JSON.parse(JSON.stringify(p)))).toEqual(p)
  })
})

describe('the move to 30-minute lessons', () => {
  it('a lesson with 41 of 60 minutes left keeps its 19 used minutes, so 11 of 30 remain', async () => {
    const { remaining } = await import('./timer')
    let open = startLesson(emptyProgress(), 0)
    open = introduce(open, 0)
    const lastActive = 19 * 60_000
    open = { ...open, lesson: { ...open.lesson!, clock: { activeMs: 19 * 60_000, lastActive: null } } }
    const p = migrateFromCourse1(parseProgress(JSON.parse(JSON.stringify({ ...open, course: 1 }))), [[0, 1, 'Das war ich.', 'That was me.']])
    expect(remaining(p.lesson!.clock, lastActive)).toBe(11 * 60_000)
  })
})
