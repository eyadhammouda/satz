import type { ExtraSentence } from './lesson'
import type { LegacyRow } from './progress'

/** One sentence of the course: the German, its English translation and other German answers that also count. */
export interface CourseSentence {
  /** Position in the course, from easiest to hardest. */
  index: number
  /** Tatoeba sentence id, for attribution: https://tatoeba.org/en/sentences/show/<id> */
  tatoebaId: number
  german: string
  english: string
  author: string
  /** The word this sentence introduces, lower case. Empty for sentences from an earlier course. */
  newWord: string
  alternatives: string[]
}

export interface CourseIndex {
  version: number
  total: number
  chunk: number
}

type RawSentence = [id: number, german: string, english: string, author: string, newWord: string, alternatives?: string[]]

const BASE = '/sentences/'
let indexPromise: Promise<CourseIndex> | undefined
const chunks = new Map<number, Promise<CourseSentence[]>>()
const loaded = new Map<number, CourseSentence[]>()

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Could not load ${url}`)
  return (await response.json()) as T
}

export function loadIndex(): Promise<CourseIndex> {
  indexPromise ??= getJson<CourseIndex>(`${BASE}index.json`).catch((error: unknown) => {
    indexPromise = undefined
    throw error
  })
  return indexPromise
}

function loadChunk(chunk: number, size: number): Promise<CourseSentence[]> {
  let promise = chunks.get(chunk)
  if (!promise) {
    promise = getJson<RawSentence[]>(`${BASE}${String(chunk).padStart(3, '0')}.json`).then(
      (rows) => {
        const sentences = rows.map(([tatoebaId, german, english, author, newWord, alternatives], i) => ({
          index: chunk * size + i,
          tatoebaId,
          german,
          english,
          author,
          newWord,
          alternatives: alternatives ?? [],
        }))
        loaded.set(chunk, sentences)
        return sentences
      },
      (error: unknown) => {
        chunks.delete(chunk)
        throw error
      },
    )
    chunks.set(chunk, promise)
  }
  return promise
}

/** Loads every chunk holding these course positions, so getSentence can answer at once. */
export async function ensureLoaded(indices: Iterable<number>): Promise<void> {
  const { chunk, total } = await loadIndex()
  const needed = new Set<number>()
  for (const i of indices) if (i >= 0 && i < total) needed.add(Math.floor(i / chunk))
  await Promise.all([...needed].map((n) => loadChunk(n, chunk)))
}

/** The map from course 1 positions to this course, for migrating saved progress. */
export async function loadLegacyV1(): Promise<LegacyRow[]> {
  return getJson<LegacyRow[]>(`${BASE}legacy-v1.json`)
}

let extras: Record<string, ExtraSentence> = {}

/** Sentences kept from an earlier course, which live at negative positions. */
export function setExtraSentences(value: Record<string, ExtraSentence>) {
  extras = value
}

/** A course sentence that is already loaded, or undefined. Negative positions are kept sentences from an earlier course. */
export function getSentence(index: number): CourseSentence | undefined {
  if (index < 0) {
    const e = extras[index]
    return e && { index, tatoebaId: e.tatoebaId, german: e.german, english: e.english, author: '', newWord: '', alternatives: e.alternatives }
  }
  for (const [, sentences] of loaded) {
    const first = sentences[0]?.index ?? 0
    if (index >= first && index < first + sentences.length) return sentences[index - first]
  }
  return undefined
}

/** For tests: forget everything loaded. */
export function resetCourseCache() {
  indexPromise = undefined
  chunks.clear()
  loaded.clear()
}
