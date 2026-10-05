import { describe, expect, it } from 'vitest'
import { createSentence } from './schedule'
import { mergeRecords, parseRecords, parseSentence, serialise } from './storage'

const today = '2026-10-05'

describe('storage records', () => {
  it('round trips through serialise and parseRecords', () => {
    const sentences = [createSentence('Ich bin da', 'I am here', today)]
    expect(parseRecords(JSON.parse(serialise(sentences)))).toEqual(sentences)
  })

  it('drops invalid records', () => {
    const good = createSentence('Ich bin da', 'I am here', today)
    const records = parseRecords({
      version: 1,
      sentences: [good, { ...good, id: '' }, { ...good, box: 9 }, { ...good, dueDay: 'soon' }, null, 'text'],
    })
    expect(records).toEqual([good])
  })

  it('rejects data without a sentence list', () => {
    expect(() => parseRecords({ version: 1 })).toThrow()
    expect(() => parseRecords(null)).toThrow()
  })

  it('validates a single record', () => {
    expect(parseSentence({ ...createSentence('a', 'b', today), lastReviewedDay: 5 })).toBeNull()
  })

  it('merges by id with records from the file winning', () => {
    const a = createSentence('a', 'A', today)
    const b = createSentence('b', 'B', today)
    const c = createSentence('c', 'C', today)
    const merged = mergeRecords([a, b], [{ ...b, english: 'new' }, c])
    expect(merged.map((s) => s.id)).toEqual([a.id, b.id, c.id])
    expect(merged[1].english).toBe('new')
  })
})
