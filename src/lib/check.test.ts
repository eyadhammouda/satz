import { describe, expect, it } from 'vitest'
import { checkAnswer, diffWords, isExactMatch, normalise } from './check'

describe('normalise', () => {
  it('converts to NFC', () => {
    expect(normalise('schön')).toBe('schön')
  })

  it('straightens curly apostrophes and quotes', () => {
    expect(normalise('Wie geht’s')).toBe("Wie geht's")
    expect(normalise('Er sagt „Hallo“')).toBe('Er sagt "Hallo"')
  })

  it('trims and collapses whitespace', () => {
    expect(normalise('  Ich   bin\tda  ')).toBe('Ich bin da')
  })

  it('removes ending punctuation', () => {
    expect(normalise('Lass mich mal sehen.')).toBe('Lass mich mal sehen')
    expect(normalise('Wirklich?!')).toBe('Wirklich')
    expect(normalise('Also…')).toBe('Also')
    expect(normalise('Ja . ')).toBe('Ja')
  })

  it('keeps punctuation inside the sentence', () => {
    expect(normalise('Ja, ich komme.')).toBe('Ja, ich komme')
  })

  it('keeps case', () => {
    expect(normalise('kilometer')).toBe('kilometer')
  })
})

describe('isExactMatch', () => {
  it('matches after normalisation', () => {
    expect(isExactMatch(' Lass  mich mal sehen! ', 'Lass mich mal sehen')).toBe(true)
  })

  it('is case sensitive', () => {
    expect(isExactMatch('lass mich mal sehen', 'Lass mich mal sehen')).toBe(false)
    expect(isExactMatch('Die Schule ist zwei kilometer weiter', 'Die Schule ist zwei Kilometer weiter')).toBe(false)
  })
})

describe('diffWords', () => {
  it('marks the wrong word in a lowercase answer', () => {
    const d = diffWords('lass mich mal sehen', 'Lass mich mal sehen')
    expect(d.answer).toEqual([
      { text: 'lass', marked: true },
      { text: 'mich', marked: false },
      { text: 'mal', marked: false },
      { text: 'sehen', marked: false },
    ])
    expect(d.target[0]).toEqual({ text: 'Lass', marked: true })
    expect(d.target.slice(1).every((w) => !w.marked)).toBe(true)
  })

  it('marks words the user left out in the target', () => {
    const d = diffWords('Ich bin sicher', 'Ich bin mir ziemlich sicher')
    expect(d.answer.every((w) => !w.marked)).toBe(true)
    expect(d.target.filter((w) => w.marked).map((w) => w.text)).toEqual(['mir', 'ziemlich'])
  })

  it('marks extra words in the answer', () => {
    const d = diffWords('Ich kann es heute nicht tun', 'Ich kann es nicht tun')
    expect(d.answer.filter((w) => w.marked).map((w) => w.text)).toEqual(['heute'])
    expect(d.target.every((w) => !w.marked)).toBe(true)
  })

  it('handles an empty answer', () => {
    const d = diffWords('', 'Ich bin da')
    expect(d.answer).toEqual([])
    expect(d.target.every((w) => w.marked)).toBe(true)
  })

  it('keeps every word of both sentences in order', () => {
    const d = diffWords('Es wird morgen regnen vielleicht', 'Es wird heute wahrscheinlich regnen')
    expect(d.answer.map((w) => w.text).join(' ')).toBe('Es wird morgen regnen vielleicht')
    expect(d.target.map((w) => w.text).join(' ')).toBe('Es wird heute wahrscheinlich regnen')
  })
})

describe('checkAnswer', () => {
  const accepted = ['Ich brauche dich.', 'Ich brauche Sie.', 'Ich brauche euch.']

  it('accepts any accepted sentence exactly', () => {
    expect(checkAnswer('Ich brauche Sie', accepted)).toEqual({ verdict: 'exact', target: 'Ich brauche Sie.' })
  })

  it('treats capitals, umlauts typed out and commas as close', () => {
    expect(checkAnswer('ich brauche dich', accepted).verdict).toBe('close')
    expect(checkAnswer('Muesst ihr gehen', ['Müsst ihr gehen?']).verdict).toBe('close')
    expect(checkAnswer('Ja ich komme', ['Ja, ich komme.']).verdict).toBe('close')
    expect(checkAnswer('Das ist gross', ['Das ist groß.']).verdict).toBe('close')
  })

  it('marks a wrong word as wrong and diffs against the closest answer', () => {
    expect(checkAnswer('Ich brauche ihn', accepted)).toEqual({ verdict: 'wrong', target: 'Ich brauche dich.' })
    expect(checkAnswer('Wir sind euch', accepted).target).toBe('Ich brauche euch.')
  })
})
