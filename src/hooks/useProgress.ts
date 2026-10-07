import { useEffect, useState } from 'react'
import { loadIndex, loadLegacyV1, setExtraSentences } from '@/lib/course'
import { COURSE_VERSION, type Progress } from '@/lib/lesson'
import { loadProgress, migrateFromCourse1, parseProgress, PROGRESS_KEY, saveProgress } from '@/lib/progress'

/** Brings progress from an earlier course onto the current one. */
export async function upgrade(progress: Progress): Promise<Progress> {
  if (progress.course === COURSE_VERSION) return progress
  if (progress.course === 1) return migrateFromCourse1(progress, await loadLegacyV1())
  throw new Error(`Unknown course ${progress.course}`)
}

export interface CourseState {
  progress: Progress
  /** Number of sentences in the course. */
  total: number
}

/**
 * The learner's progress and the course, or null while loading. Progress is saved to
 * localStorage after every change, kept in step across tabs, and moved onto the
 * current course first if it was saved against an earlier one.
 */
export function useProgress() {
  const [state, setState] = useState<CourseState | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([loadIndex(), upgrade(loadProgress())]).then(
      ([index, progress]) => {
        if (!cancelled) setState({ progress, total: index.total })
      },
      () => {
        if (!cancelled) setFailed(true)
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  const progress = state?.progress
  useEffect(() => {
    if (!progress) return
    setExtraSentences(progress.extra)
    saveProgress(progress)
  }, [progress])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== PROGRESS_KEY || event.newValue === null) return
      try {
        const next = parseProgress(JSON.parse(event.newValue))
        if (next.course === COURSE_VERSION) setState((s) => s && { ...s, progress: next })
      } catch {
        // Ignore a value this tab cannot read.
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const setProgress = (update: Progress | ((p: Progress) => Progress)) =>
    setState((s) => s && { ...s, progress: typeof update === 'function' ? update(s.progress) : update })

  return { state, failed, setProgress }
}

/** The current time, updated every `ms` milliseconds while mounted. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms)
    const refresh = () => setNow(Date.now())
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [ms])
  return now
}
