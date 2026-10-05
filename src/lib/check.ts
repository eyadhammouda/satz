/**
 * Normalises a sentence for comparison. Case is kept on purpose: German nouns
 * are capitalised and getting that right is part of the answer.
 */
export function normalise(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.!?…]+$/, '')
    .trimEnd()
}

export function isExactMatch(answer: string, target: string): boolean {
  return normalise(answer) === normalise(target)
}

export interface DiffWord {
  text: string
  /** In the answer: the word does not belong. In the target: the user left it out. */
  marked: boolean
}

export interface WordDiff {
  answer: DiffWord[]
  target: DiffWord[]
}

function words(text: string): string[] {
  const normalised = normalise(text)
  return normalised ? normalised.split(' ') : []
}

/** Word by word longest-common-subsequence diff between an answer and the target. */
export function diffWords(answer: string, target: string): WordDiff {
  const a = words(answer)
  const b = words(target)
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const result: WordDiff = { answer: [], target: [] }
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      result.answer.push({ text: a[i++], marked: false })
      result.target.push({ text: b[j++], marked: false })
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      result.answer.push({ text: a[i++], marked: true })
    } else {
      result.target.push({ text: b[j++], marked: true })
    }
  }
  while (i < a.length) result.answer.push({ text: a[i++], marked: true })
  while (j < b.length) result.target.push({ text: b[j++], marked: true })
  return result
}

/** Folds what a missing German keyboard or a capitals slip changes: ae for ä, ss for ß, and case. */
export function fold(text: string): string {
  return normalise(text)
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[,;:]/g, '')
    .replace(/\s+/g, ' ')
}

export type Verdict = 'exact' | 'close' | 'wrong'

export interface Checked {
  verdict: Verdict
  /** The accepted answer closest to what was typed, used for the word diff. */
  target: string
}

const overlap = (answer: string, target: string) => diffWords(answer, target).target.filter((w) => !w.marked).length

/**
 * Checks an answer against every accepted German sentence.
 * exact: right, word for word. close: right apart from capitals, umlauts typed as ae, oe, ue, ss, or commas.
 */
export function checkAnswer(answer: string, accepted: string[]): Checked {
  const exact = accepted.find((t) => isExactMatch(answer, t))
  if (exact) return { verdict: 'exact', target: exact }
  const close = accepted.find((t) => fold(answer) === fold(t))
  if (close) return { verdict: 'close', target: close }
  const best = accepted.reduce((a, b) => (overlap(answer, b) > overlap(answer, a) ? b : a), accepted[0] ?? '')
  return { verdict: 'wrong', target: best }
}
