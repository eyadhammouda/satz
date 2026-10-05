import { useCallback, useEffect, useRef, useState } from 'react'
import { normalise } from '@/lib/check'
import { createSentence, studyDay } from '@/lib/schedule'
import { loadSentences, mergeRecords, saveSentences, STORAGE_KEY, parseRecords } from '@/lib/storage'
import type { Sentence } from '@/lib/types'

/** The current study day, refreshed when the window regains focus or the day rolls over. */
export function useStudyDay(): string {
  const [day, setDay] = useState(() => studyDay())
  useEffect(() => {
    const refresh = () => setDay(studyDay())
    const timer = setInterval(refresh, 60_000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])
  return day
}

export type AddResult = 'added' | 'empty' | 'duplicate'

export function useSentences() {
  const [sentences, setSentences] = useState<Sentence[]>(() => loadSentences(studyDay()))
  const saveFailed = useRef(false)

  // Save after every change, including the first seed.
  useEffect(() => {
    saveFailed.current = !saveSentences(sentences)
  }, [sentences])

  // Keep several open tabs in step.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || event.newValue === null) return
      try {
        setSentences(parseRecords(JSON.parse(event.newValue)))
      } catch {
        // Ignore a value this tab cannot read.
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const add = useCallback(
    (german: string, english: string): AddResult => {
      if (!german.trim() || !english.trim()) return 'empty'
      const key = normalise(german)
      if (sentences.some((s) => normalise(s.german) === key)) return 'duplicate'
      setSentences((prev) => [createSentence(german, english, studyDay()), ...prev])
      return 'added'
    },
    [sentences],
  )

  const update = useCallback((id: string, changes: Partial<Sentence>) => {
    setSentences((prev) => prev.map((s) => (s.id === id ? { ...s, ...changes } : s)))
  }, [])

  const remove = useCallback((id: string) => {
    setSentences((prev) => prev.filter((s) => s.id !== id))
  }, [])

  const importRecords = useCallback((incoming: Sentence[]) => {
    setSentences((prev) => mergeRecords(prev, incoming))
  }, [])

  return { sentences, add, update, remove, importRecords, saveFailed }
}
