import { describe, expect, it } from 'vitest'
import { emptyProgress, endLesson, introduce, recordAnswer, startLesson } from './lesson'
import { parseProgress } from './progress'

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
