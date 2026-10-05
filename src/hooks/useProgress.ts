import { useEffect, useState } from 'react'
import { loadProgress, parseProgress, PROGRESS_KEY, saveProgress } from '@/lib/progress'
import type { Progress } from '@/lib/lesson'

/** The learner's progress, saved to localStorage after every change and kept in step across tabs. */
export function useProgress() {
  const [progress, setProgress] = useState<Progress>(loadProgress)

  useEffect(() => {
    saveProgress(progress)
  }, [progress])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== PROGRESS_KEY || event.newValue === null) return
      try {
        setProgress(parseProgress(JSON.parse(event.newValue)))
      } catch {
        // Ignore a value this tab cannot read.
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return [progress, setProgress] as const
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
