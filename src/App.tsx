import { useEffect, useEffectEvent, useState } from 'react'
import { Toaster } from '@/components/ui/sonner'
import { useGermanVoice, VoiceContext } from '@/hooks/useGermanVoice'
import { upgrade, useProgress } from '@/hooks/useProgress'
import { resumeOrStart, type Progress } from '@/lib/lesson'
import { fitModel, needsFit } from '@/lib/model'
import Home from '@/screens/Home'
import Lesson from '@/screens/Lesson'
import ProgressView from '@/screens/Progress'

export default function App() {
  const { state, failed, setProgress } = useProgress()
  const [inLesson, setInLesson] = useState(false)
  const [showProgress, setShowProgress] = useState(false)
  const voice = useGermanVoice()

  // Between lessons, refit the memory model to this learner's answers when enough new ones have come in.
  const fit = useEffectEvent(() => {
    const progress = state?.progress
    if (inLesson || !progress || !needsFit(progress, Date.now())) return
    void fitModel(progress, Date.now()).then((model) => {
      if (model) setProgress((p) => ({ ...p, model }))
    })
  })
  const loaded = state !== null
  useEffect(() => {
    if (loaded && !inLesson) fit()
  }, [loaded, inLesson])

  const start = () => {
    setProgress((p) => resumeOrStart(p, Date.now()))
    setInLesson(true)
  }

  // An imported file may come from an earlier course.
  const importProgress = async (progress: Progress) => setProgress(await upgrade(progress))

  return (
    <VoiceContext value={voice}>
      {inLesson && state ? (
        <Lesson progress={state.progress} total={state.total} setProgress={setProgress} onClose={() => setInLesson(false)} />
      ) : (
        <div className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col px-6 pt-[max(env(safe-area-inset-top),2rem)] pb-[max(env(safe-area-inset-bottom),2rem)]">
          <main className="flex flex-1 flex-col">
            {showProgress && state ? (
              <ProgressView progress={state.progress} onBack={() => setShowProgress(false)} />
            ) : (
              <Home
                state={state}
                failed={failed}
                onStart={start}
                onImport={importProgress}
                onShowProgress={() => setShowProgress(true)}
              />
            )}
          </main>
        </div>
      )}
      <Toaster />
    </VoiceContext>
  )
}
