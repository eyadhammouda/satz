import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { ListenButton } from '@/components/ListenButton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useNow } from '@/hooks/useProgress'
import { useVoice } from '@/hooks/useGermanVoice'
import { checkAnswer, diffWords, type DiffWord, type Verdict } from '@/lib/check'
import { ensureLoaded, getSentence, type CourseSentence } from '@/lib/course'
import { endLesson, introduce, nextStep, recordAnswer, summarise, type LessonRecord, type Progress, type Step } from '@/lib/lesson'
import { elapsed, formatClock, isIdle, LESSON_MS, pause, ping } from '@/lib/timer'

/** answering: typing. checked: the answer is shown, Enter moves on, 1 and 2 override. */
type Phase = 'answering' | 'checked'

interface Props {
  progress: Progress
  total: number
  setProgress: (update: (p: Progress) => Progress) => void
  onClose: () => void
}

export default function Lesson({ progress, total, setProgress, onClose }: Props) {
  const now = useNow(1000)
  const voice = useVoice()
  const lesson = progress.lesson
  const [step, setStep] = useState<Step | null>(null)
  const [round, setRound] = useState(0)
  const [phase, setPhase] = useState<Phase>('answering')
  const [input, setInput] = useState('')
  const [result, setResult] = useState<{ verdict: Verdict; target: string; answer: string } | null>(null)
  const [summary, setSummary] = useState<LessonRecord | null>(null)
  const [loadError, setLoadError] = useState(false)
  // Bumped to ask for the next card again, for example after a failed load.
  const [attempt, setAttempt] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const continueRef = useRef<HTMLButtonElement>(null)

  const sentence: CourseSentence | undefined = step && step.kind !== 'done' ? getSentence(step.index) : undefined
  const accepted = sentence ? [sentence.german, ...sentence.alternatives, ...(progress.accepted[sentence.index] ?? [])] : []

  // Picks the next card, but only between cards: an answer in progress is never interrupted.
  const choose = useEffectEvent(async () => {
    const current = progress
    const at = Date.now()
    const next = nextStep(current, total, at)
    if (next.kind === 'done') {
      if (current.lesson) setSummary(summarise(current.lesson, at))
      setProgress((p) => endLesson(p, at))
      setStep(next)
      return
    }
    try {
      await ensureLoaded([next.index, next.index + 1, next.index + 2])
      setLoadError(false)
    } catch {
      setLoadError(true)
      return
    }
    setStep(next)
    setPhase('answering')
    setInput('')
    setResult(null)
    setRound((r) => r + 1)
  })

  useEffect(() => {
    if (step === null) void choose()
  }, [step, attempt])

  const advance = () => {
    setStep(null)
  }

  // A new sentence is read twice as soon as it appears, a second apart. A listening test is read once.
  const playCard = useEffectEvent(() => {
    if (!sentence || !voice) return
    if (step?.kind === 'intro') voice.speak(sentence.german, 2)
    else if (step?.kind === 'test' && step.mode === 'listen') voice.speak(sentence.german)
  })
  useEffect(() => {
    playCard()
  }, [round])

  useEffect(() => {
    if (!step || step.kind === 'done') return
    if (step.kind === 'intro' || phase === 'checked') continueRef.current?.focus({ preventScroll: true })
    else inputRef.current?.focus({ preventScroll: true })
  }, [round, phase, step])

  // Activity keeps the lesson clock running. Leaving the tab pauses it.
  const touch = useEffectEvent(() => {
    setProgress((p) => (p.lesson ? { ...p, lesson: { ...p.lesson, clock: ping(p.lesson.clock, Date.now()) } } : p))
  })
  const stop = useEffectEvent(() => {
    setProgress((p) => (p.lesson ? { ...p, lesson: { ...p.lesson, clock: pause(p.lesson.clock, Date.now()) } } : p))
  })
  useEffect(() => {
    let last = 0
    const onActivity = () => {
      if (Date.now() - last < 5_000) return
      last = Date.now()
      touch()
    }
    const onVisibility = () => (document.hidden ? stop() : touch())
    window.addEventListener('keydown', onActivity)
    window.addEventListener('pointerdown', onActivity)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', stop)
    return () => {
      window.removeEventListener('keydown', onActivity)
      window.removeEventListener('pointerdown', onActivity)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', stop)
      stop()
    }
  }, [])

  const showIntro = () => {
    if (step?.kind !== 'intro') return
    setProgress((p) => introduce(p, Date.now()))
    advance()
  }

  const check = () => {
    if (step?.kind !== 'test' || !sentence) return
    const outcome = input.trim() ? checkAnswer(input, accepted) : { verdict: 'wrong' as const, target: sentence.german }
    setResult({ ...outcome, answer: input })
    setPhase('checked')
    if (voice && step.mode === 'type') voice.speak(outcome.target)
  }

  const grade = (pass: boolean, acceptAnswer = false) => {
    if (step?.kind !== 'test' || !sentence) return
    const at = Date.now()
    const answer = result?.answer.trim()
    setProgress((p) => {
      const next = recordAnswer(p, step.index, pass, step.reason, at)
      if (!acceptAnswer || !answer) return next
      const list = next.accepted[step.index] ?? []
      return { ...next, accepted: { ...next.accepted, [step.index]: [...list, answer] } }
    })
    advance()
  }

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (!step || step.kind === 'done') return
    if (step.kind === 'intro') {
      if (event.key === 'Enter') {
        event.preventDefault()
        showIntro()
      }
      return
    }
    if (phase === 'answering') {
      if (event.key === 'Enter' && event.target === inputRef.current) {
        event.preventDefault()
        check()
      }
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      grade(result?.verdict !== 'wrong')
    } else if (event.key === '1' && result?.verdict !== 'wrong') {
      event.preventDefault()
      grade(false)
    } else if (event.key === '2' && result?.verdict === 'wrong') {
      event.preventDefault()
      grade(true, true)
    }
  })

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  const spent = lesson ? elapsed(lesson.clock, now) : (summary?.activeMs ?? LESSON_MS)
  const left = Math.max(0, LESSON_MS - spent)
  const idle = lesson ? isIdle(lesson.clock, now) : false
  const diff = result && result.verdict !== 'exact' ? diffWords(result.answer, result.target) : null

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col px-6 pt-[max(env(safe-area-inset-top),1.25rem)] pb-[max(env(safe-area-inset-bottom),2rem)]">
      <header className="flex items-center gap-4">
        <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div
            className="absolute inset-0 origin-left bg-primary transition-transform duration-1000 ease-linear"
            style={{ transform: `scaleX(${Math.min(1, spent / LESSON_MS)})` }}
          />
        </div>
        <span
          className="text-[13px] whitespace-nowrap text-muted-foreground tabular-nums"
          role="timer"
          aria-label={`${formatClock(left)} left in this lesson`}
          title={idle ? 'Paused while you are away' : 'Time left in this lesson'}
        >
          {idle ? 'Paused' : formatClock(left)}
        </span>
        <Button variant="ghost" size="icon" className="-mr-3 text-muted-foreground" aria-label="Close" onClick={onClose}>
          <X className="size-5" />
        </Button>
      </header>

      {summary || step?.kind === 'done' ? (
        <Summary record={summary} onDone={onClose} />
      ) : loadError ? (
        <main className="flex flex-1 flex-col items-center pt-[20vh] text-center">
          <p className="text-[17px]">Could not load the next sentences.</p>
          <Button size="lg" className="mt-8" onClick={() => setAttempt((a) => a + 1)}>
            Try again
          </Button>
        </main>
      ) : !step || !sentence ? (
        <main className="flex-1" aria-busy />
      ) : step.kind === 'intro' ? (
        <main key={round} className="fade-in flex flex-1 flex-col pt-[12vh]">
          <p className="text-[13px] text-muted-foreground">New sentence</p>
          <p className="mt-3 text-[22px] leading-[1.3] text-muted-foreground text-balance">{sentence.english}</p>
          <div className="mt-6 flex items-start gap-2">
            <p lang="de" className="flex-1 text-[32px] leading-[1.2] font-medium tracking-[-0.02em] text-balance">
              <Highlight text={sentence.german} word={sentence.newWord} />
            </p>
            <ListenButton text={sentence.german} size="icon" className="-mt-0.5 -mr-3" />
          </div>
          <p className="mt-8 text-[15px] text-muted-foreground">
            {sentence.newWord ? 'New word underlined. ' : ''}Listen, then say it aloud twice.
          </p>
          <Button ref={continueRef} size="lg" className="mt-10 self-start" onClick={showIntro}>
            I said it
            <Kbd>Enter</Kbd>
          </Button>
        </main>
      ) : (
        <main key={round} className="flex flex-1 flex-col pt-[12vh]">
          <p className="text-[13px] text-muted-foreground">
            {step.mode === 'listen' ? 'Type what you hear' : step.reason === 'review' ? 'Review' : 'Say it, then type it'}
          </p>
          {step.mode === 'listen' ? (
            <div className="fade-in mt-3 flex items-center gap-3">
              <ListenButton text={sentence.german} size="icon" className="-ml-3" />
              <p className="text-[22px] leading-[1.3] text-muted-foreground">{phase === 'checked' ? sentence.english : 'Listen'}</p>
            </div>
          ) : (
            <p className="fade-in mt-3 text-[30px] leading-[1.2] font-medium tracking-[-0.02em] text-balance">
              {sentence.english}
            </p>
          )}

          <label htmlFor="lesson-answer" className="sr-only">
            German
          </label>
          <Input
            ref={inputRef}
            id="lesson-answer"
            lang="de"
            placeholder="Type the German"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="go"
            readOnly={phase !== 'answering'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="mt-8 h-13 text-[18px] read-only:text-muted-foreground"
          />

          {phase === 'checked' && result && (
            <div className="mt-8">
              <div className="flex items-start gap-2">
                <p lang="de" className="flex-1 text-[26px] leading-[1.25] font-medium tracking-[-0.015em] text-balance">
                  {diff ? <Words words={diff.target} kind="missing" /> : result.target}
                </p>
                <ListenButton text={result.target} size="icon" className="-mt-1.5 -mr-3" />
              </div>
              {diff && result.answer.trim() && (
                <p lang="de" className="mt-3 text-[17px] text-muted-foreground">
                  <span className="sr-only">Your answer: </span>
                  <Words words={diff.answer} kind="wrong" />
                </p>
              )}
              {result.target !== sentence.german && (
                <p lang="de" className="mt-2 text-[13px] text-muted-foreground">
                  Also: {sentence.german}
                </p>
              )}

              <p className="mt-3 text-[13px] text-muted-foreground">Say it aloud once more.</p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <p className="mr-auto text-[15px] font-medium" role="status">
                  {result.verdict === 'exact' ? 'Correct' : result.verdict === 'close' ? 'Correct, mind the spelling' : 'Not quite'}
                </p>
                {result.verdict === 'wrong' ? (
                  <>
                    {result.answer.trim() && (
                      <Button variant="ghost" onClick={() => grade(true, true)}>
                        I was right
                        <Kbd>2</Kbd>
                      </Button>
                    )}
                    <Button ref={continueRef} size="lg" variant="secondary" onClick={() => grade(false)}>
                      Continue
                      <Kbd>Enter</Kbd>
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="ghost" onClick={() => grade(false)}>
                      I guessed
                      <Kbd>1</Kbd>
                    </Button>
                    <Button ref={continueRef} size="lg" variant="secondary" onClick={() => grade(true)}>
                      Continue
                      <Kbd>Enter</Kbd>
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
        </main>
      )}
    </div>
  )
}

/** The sentence with its new word underlined. Matches the word in any case. */
function Highlight({ text, word }: { text: string; word: string }) {
  if (!word) return text
  const parts = text.split(/([A-Za-zÄÖÜäöüß]+(?:-[A-Za-zÄÖÜäöüß]+)*)/)
  let done = false
  return parts.map((part, i) => {
    if (!done && part.toLowerCase() === word) {
      done = true
      return (
        <span key={i} className="underline decoration-2 decoration-foreground/40 underline-offset-[6px]">
          {part}
        </span>
      )
    }
    return part
  })
}

function Words({ words, kind }: { words: DiffWord[]; kind: 'missing' | 'wrong' }) {
  return words.map((word, i) => (
    <span key={i}>
      {i > 0 && ' '}
      {word.marked ? (
        kind === 'missing' ? (
          <span className="underline decoration-destructive decoration-2 underline-offset-[5px]">
            <span className="sr-only">missing: </span>
            {word.text}
          </span>
        ) : (
          <span className="text-destructive">
            <span className="sr-only">wrong: </span>
            {word.text}
          </span>
        )
      ) : (
        word.text
      )}
    </span>
  ))
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="ml-1 hidden rounded-[5px] border border-current/15 px-1.5 font-sans text-[11px] leading-[18px] text-muted-foreground [@media(pointer:fine)]:inline-block">
      {children}
    </kbd>
  )
}

function Summary({ record, onDone }: { record: LessonRecord | null; onDone: () => void }) {
  const minutes = record ? Math.round(record.activeMs / 60_000) : 0
  return (
    <main className="fade-in flex flex-1 flex-col items-center pt-[14vh] text-center">
      <h1 className="text-[28px] leading-tight font-semibold tracking-tight">Lesson done</h1>
      <dl className="mt-10 flex gap-12 tabular-nums">
        <Stat label="New sentences" value={record?.introduced ?? 0} />
        <Stat label="Practised" value={record?.reviewed ?? 0} />
        <Stat label="First try" value={record?.firstTryCorrect ?? 0} />
      </dl>
      <p className="mt-8 text-[15px] text-muted-foreground">{minutes} minutes of practice</p>
      <Button size="lg" className="mt-12 w-full max-w-[280px]" autoFocus onClick={onDone}>
        Done
      </Button>
    </main>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col-reverse items-center">
      <dt className="mt-1 text-[13px] text-muted-foreground">{label}</dt>
      <dd className="text-[44px] leading-none font-semibold tracking-[-0.03em]">{value}</dd>
    </div>
  )
}
