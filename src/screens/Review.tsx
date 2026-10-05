import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { Volume2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { useGermanVoice } from '@/hooks/useGermanVoice'
import { diffWords, isExactMatch, type DiffWord } from '@/lib/check'
import {
  answer,
  completedCount,
  firstTryCorrectCount,
  gradeCorrect,
  gradeMissed,
  startSession,
  studyDay,
  type Outcome,
} from '@/lib/schedule'
import type { Sentence } from '@/lib/types'

export type ReviewMode = 'review' | 'practice'

/** answering: typing. correct: exact match, Enter moves on. checked or revealed: the user grades with 1 or 2. */
type Phase = 'answering' | 'correct' | 'checked' | 'revealed'

interface Props {
  mode: ReviewMode
  ids: string[]
  sentences: Sentence[]
  onGrade: (id: string, changes: Partial<Sentence>) => void
  onClose: () => void
}

export default function Review({ mode, ids, sentences, onGrade, onClose }: Props) {
  const [session, setSession] = useState(() => startSession(ids))
  const [currentId, setCurrentId] = useState<string | undefined>(ids[0])
  const [round, setRound] = useState(0)
  const [phase, setPhase] = useState<Phase>('answering')
  const [input, setInput] = useState('')
  const [checkedInput, setCheckedInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const speak = useGermanVoice()

  // Keep the card text even if the sentence is edited or deleted in another tab.
  const [cards] = useState(() => new Map(sentences.filter((s) => ids.includes(s.id)).map((s) => [s.id, s])))
  const card = currentId ? cards.get(currentId) : undefined
  const done = currentId === undefined

  const record = (outcome: Outcome) => {
    if (!currentId) return session
    const { session: next, firstAttempt } = answer(session, outcome)
    setSession(next)
    // Only the first attempt in a scheduled review changes the schedule.
    const latest = sentences.find((s) => s.id === currentId)
    if (mode === 'review' && firstAttempt && latest) {
      const graded = outcome === 'correct' ? gradeCorrect(latest, studyDay()) : gradeMissed(latest, studyDay())
      onGrade(currentId, {
        box: graded.box,
        dueDay: graded.dueDay,
        lastReviewedDay: graded.lastReviewedDay,
        correct: graded.correct,
        missed: graded.missed,
      })
    }
    return next
  }

  const advance = (next = session) => {
    setCurrentId(next.queue[0])
    setRound((r) => r + 1)
    setPhase('answering')
    setInput('')
    setCheckedInput('')
  }

  const check = () => {
    if (!card) return
    if (!input.trim()) {
      setPhase('revealed')
      return
    }
    setCheckedInput(input)
    if (isExactMatch(input, card.german)) {
      record('correct')
      setPhase('correct')
    } else {
      setPhase('checked')
    }
  }

  const grade = (outcome: Outcome) => advance(record(outcome))

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (done) return
    if (phase === 'answering') {
      if (event.key === 'Enter' && event.target === inputRef.current) {
        event.preventDefault()
        check()
      }
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (phase === 'correct') advance()
      return
    }
    if (event.key === '1') {
      event.preventDefault()
      grade('missed')
    } else if (event.key === '2') {
      event.preventDefault()
      grade('correct')
    }
  })

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  // Return focus to the input for every new card.
  useEffect(() => {
    if (!done) inputRef.current?.focus({ preventScroll: true })
  }, [round, done])

  const completed = completedCount(session)
  const position = Math.min(completed + 1, session.total)
  const diff = phase === 'checked' && card ? diffWords(checkedInput, card.german) : null

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col px-6 pt-[max(env(safe-area-inset-top),1.25rem)] pb-[max(env(safe-area-inset-bottom),2rem)]">
      <header className="flex items-center gap-4">
        <Progress
          value={(completed / Math.max(session.total, 1)) * 100}
          aria-label="Progress"
          className="flex-1"
        />
        {!done && (
          <span className="text-[13px] whitespace-nowrap text-muted-foreground tabular-nums">
            {position} of {session.total}
          </span>
        )}
        <Button variant="ghost" size="icon" className="-mr-3 text-muted-foreground" aria-label="Close" onClick={onClose}>
          <X className="size-5" />
        </Button>
      </header>

      {done ? (
        <Summary reviewed={session.total} firstTry={firstTryCorrectCount(session)} onDone={onClose} />
      ) : (
        <main className="flex flex-1 flex-col pt-[14vh]">
          <p key={round} className="fade-in text-[30px] leading-[1.2] font-medium tracking-[-0.02em] text-balance">
            {card?.english}
          </p>

          <label htmlFor="review-answer" className="sr-only">
            German translation
          </label>
          <Input
            ref={inputRef}
            id="review-answer"
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
            className="mt-10 h-13 text-[18px] read-only:text-muted-foreground"
          />

          {phase !== 'answering' && card && (
            <div key={`answer-${round}`} className="mt-10">
              <div className="flex items-start gap-2">
                <p lang="de" className="flex-1 text-[26px] leading-[1.25] font-medium tracking-[-0.015em] text-balance">
                  {diff ? <Words words={diff.target} kind="missing" /> : card.german}
                </p>
                {speak && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="-mt-1.5 -mr-3 text-muted-foreground"
                    aria-label="Read aloud"
                    onClick={() => speak(card.german)}
                  >
                    <Volume2 className="size-5" />
                  </Button>
                )}
              </div>

              {diff && (
                <p lang="de" className="mt-3 text-[17px] text-muted-foreground">
                  <span className="sr-only">Your answer: </span>
                  <Words words={diff.answer} kind="wrong" />
                </p>
              )}

              {phase === 'correct' ? (
                <div className="mt-10 flex items-center justify-between gap-4">
                  <p className="text-[15px] font-medium" role="status">
                    Correct
                  </p>
                  <Button size="lg" variant="secondary" onClick={() => advance()}>
                    Continue
                    <Kbd>Enter</Kbd>
                  </Button>
                </div>
              ) : (
                <div className="mt-10 grid grid-cols-2 gap-3">
                  <Button size="lg" variant="secondary" onClick={() => grade('missed')}>
                    Missed
                    <Kbd>1</Kbd>
                  </Button>
                  <Button size="lg" variant="secondary" onClick={() => grade('correct')}>
                    Got it
                    <Kbd>2</Kbd>
                  </Button>
                </div>
              )}
            </div>
          )}
        </main>
      )}
    </div>
  )
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

function Summary({ reviewed, firstTry, onDone }: { reviewed: number; firstTry: number; onDone: () => void }) {
  return (
    <main className="fade-in flex flex-1 flex-col items-center pt-[16vh] text-center">
      <dl className="flex gap-14">
        <div className="flex flex-col-reverse items-center">
          <dt className="mt-1 text-[13px] text-muted-foreground">Reviewed</dt>
          <dd className="text-[56px] leading-none font-semibold tracking-[-0.03em] tabular-nums">{reviewed}</dd>
        </div>
        <div className="flex flex-col-reverse items-center">
          <dt className="mt-1 text-[13px] text-muted-foreground">First try correct</dt>
          <dd className="text-[56px] leading-none font-semibold tracking-[-0.03em] tabular-nums">{firstTry}</dd>
        </div>
      </dl>
      <Button size="lg" className="mt-14 w-full max-w-[280px]" autoFocus onClick={onDone}>
        Done
      </Button>
    </main>
  )
}
