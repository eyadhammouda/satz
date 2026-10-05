import { useEffect, useState } from 'react'
import { Toaster } from '@/components/ui/sonner'
import { useGermanVoice, VoiceContext } from '@/hooks/useGermanVoice'
import { useProgress } from '@/hooks/useProgress'
import { loadIndex } from '@/lib/course'
import { studyDay } from '@/lib/day'
import { resumeOrStart } from '@/lib/lesson'
import Home from '@/screens/Home'
import Lesson from '@/screens/Lesson'

export default function App() {
  const [progress, setProgress] = useProgress()
  const [total, setTotal] = useState<number | null>(null)
  const [inLesson, setInLesson] = useState(false)
  const voice = useGermanVoice()

  useEffect(() => {
    loadIndex().then(
      (index) => setTotal(index.total),
      () => setTotal(null),
    )
  }, [])

  const start = () => {
    setProgress((p) => resumeOrStart(p, Date.now(), (a, b) => studyDay(a) === studyDay(b)))
    setInLesson(true)
  }

  return (
    <VoiceContext value={voice}>
      {inLesson && total !== null ? (
        <Lesson progress={progress} total={total} setProgress={setProgress} onClose={() => setInLesson(false)} />
      ) : (
        <div className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col px-6 pt-[max(env(safe-area-inset-top),2rem)] pb-[max(env(safe-area-inset-bottom),2rem)]">
          <main className="flex flex-1 flex-col">
            <Home progress={progress} total={total} onStart={start} onImport={setProgress} />
          </main>
        </div>
      )}
      <Toaster />
    </VoiceContext>
  )
}
