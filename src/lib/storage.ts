import { seedSentences } from './seed'
import type { Sentence, StoredData } from './types'

export const STORAGE_KEY = 'satz.v1'
const BROKEN_KEY = 'satz.v1.unreadable'
const DAY = /^\d{4}-\d{2}-\d{2}$/

const isDay = (value: unknown): value is string => typeof value === 'string' && DAY.test(value)
const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0

/** Returns a clean Sentence, or null when the record is not valid. */
export function parseSentence(value: unknown): Sentence | null {
  if (typeof value !== 'object' || value === null) return null
  const r = value as Record<string, unknown>
  if (typeof r.id !== 'string' || !r.id) return null
  if (typeof r.german !== 'string' || !r.german.trim()) return null
  if (typeof r.english !== 'string' || !r.english.trim()) return null
  if (!isDay(r.createdDay) || !isDay(r.dueDay)) return null
  if (!isCount(r.box) || r.box > 5) return null
  if (r.lastReviewedDay !== null && !isDay(r.lastReviewedDay)) return null
  if (!isCount(r.correct) || !isCount(r.missed)) return null
  return {
    id: r.id,
    german: r.german.trim(),
    english: r.english.trim(),
    createdDay: r.createdDay,
    box: r.box,
    dueDay: r.dueDay,
    lastReviewedDay: r.lastReviewedDay,
    correct: r.correct,
    missed: r.missed,
  }
}

/** Reads the valid sentences out of a stored or exported object. Throws when there is no sentence list. */
export function parseRecords(data: unknown): Sentence[] {
  const list = (data as Partial<StoredData> | null)?.sentences
  if (!Array.isArray(list)) throw new Error('No sentence list')
  return list.map(parseSentence).filter((s): s is Sentence => s !== null)
}

/** Merges imported records by id. Records from the file win. */
export function mergeRecords(existing: Sentence[], incoming: Sentence[]): Sentence[] {
  const byId = new Map(incoming.map((s) => [s.id, s]))
  const merged = existing.map((s) => byId.get(s.id) ?? s)
  const known = new Set(existing.map((s) => s.id))
  return [...merged, ...incoming.filter((s) => !known.has(s.id))]
}

export function loadSentences(today: string): Sentence[] {
  let raw: string | null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    return seedSentences(today)
  }
  if (raw === null) return seedSentences(today)
  try {
    return parseRecords(JSON.parse(raw))
  } catch {
    // Keep a copy of the unreadable value before it gets replaced.
    try {
      localStorage.setItem(BROKEN_KEY, raw)
    } catch {
      // Nothing more to do.
    }
    return seedSentences(today)
  }
}

export function serialise(sentences: Sentence[]): string {
  const data: StoredData = { version: 1, sentences }
  return JSON.stringify(data)
}

export function saveSentences(sentences: Sentence[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, serialise(sentences))
    return true
  } catch {
    return false
  }
}

export function exportBackup(sentences: Sentence[], today: string): void {
  const data: StoredData = { version: 1, sentences }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `satz-backup-${today}.json`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Reads an exported backup file. Throws when it is not a backup. */
export async function readBackup(file: File): Promise<Sentence[]> {
  return parseRecords(JSON.parse(await file.text()))
}
