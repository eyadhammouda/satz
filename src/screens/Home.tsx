import { useRef } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useNow, type CourseState } from '@/hooks/useProgress'
import { studyDay } from '@/lib/day'
import { dueReviewCount, emptyProgress, type Progress } from '@/lib/lesson'
import { MIN_REVIEWS } from '@/lib/model'
import { exportProgress, readProgressFile } from '@/lib/progress'
import { elapsed, formatClock, LESSON_MS } from '@/lib/timer'

interface Props {
  state: CourseState | null
  failed: boolean
  onStart: () => void
  onImport: (progress: Progress) => Promise<void>
  onShowProgress: () => void
}

export default function Home({ state, failed, onStart, onImport, onShowProgress }: Props) {
  const now = useNow(30_000)
  const fileRef = useRef<HTMLInputElement>(null)
  const progress = state?.progress ?? emptyProgress()
  const total = state?.total ?? null
  const due = dueReviewCount(progress, now)
  const learned = Object.keys(progress.cards).length
  const today = studyDay(now)
  // Today's finished lessons, plus the one still open.
  const todays = [
    ...progress.history,
    ...(progress.lesson ? [{ started: progress.lesson.started, activeMs: progress.lesson.clock.activeMs, introduced: progress.lesson.introduced.length }] : []),
  ].filter((h) => studyDay(h.started) === today)
  const minutesToday = Math.round(todays.reduce((sum, h) => sum + h.activeMs, 0) / 60_000)
  const learnedToday = todays.reduce((sum, h) => sum + h.introduced, 0)
  // An unfinished lesson carries on, whatever the day.
  const open = progress.lesson
  const left = open ? Math.max(0, LESSON_MS - elapsed(open.clock, now)) : 0
  const finished = total !== null && progress.next >= total && due === 0

  const importFile = async (file: File) => {
    try {
      await onImport(await readProgressFile(file))
      toast('Progress restored')
    } catch {
      toast('This file is not Satz progress')
    }
  }

  return (
    <section className="flex flex-1 flex-col items-center pt-[12vh] text-center">
      <h1 className="text-[40px] leading-none font-semibold tracking-[-0.03em]">Satz</h1>
      <p className="mt-3 text-[15px] text-muted-foreground">
        {learned === 0
          ? 'Thirty minutes. One new word in every sentence.'
          : due > 0
            ? `${due} ${due === 1 ? 'sentence' : 'sentences'} to review, then new ones`
            : 'Nothing to review. All new sentences today'}
      </p>

      <div className="mt-12 flex w-full max-w-[280px] flex-col gap-3">
        <Button size="lg" onClick={onStart} disabled={total === null || finished}>
          {open ? `Continue lesson · ${formatClock(left)} left` : "Start today's lesson"}
        </Button>
      </div>

      {total === null && (
        <p className="mt-4 text-[13px] text-muted-foreground">{failed ? 'Could not load the sentences. Reload to try again.' : 'Loading sentences'}</p>
      )}

      <dl className="mt-14 flex gap-12 tabular-nums">
        <Stat label="Learned" value={learned} />
        <Stat label="Today" value={learnedToday} />
        <Stat label="Minutes today" value={minutesToday} />
      </dl>

      <p className="mt-10 max-w-[320px] text-[13px] text-muted-foreground">{memoryLine(progress)}</p>
      <Button variant="ghost" size="sm" className="mt-2 text-muted-foreground" disabled={!state} onClick={onShowProgress}>
        See progress
      </Button>

      <div className="mt-auto flex justify-center gap-2 pt-14">
        <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={!state} onClick={() => exportProgress(progress, today)}>
          Export
        </Button>
        <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={!state} onClick={() => fileRef.current?.click()}>
          Import
        </Button>
        <form method="post" action="/api/auth/logout">
          <Button type="submit" variant="ghost" size="sm" className="text-muted-foreground">
            Sign out
          </Button>
        </form>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          aria-hidden
          tabIndex={-1}
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void importFile(file)
          }}
        />
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground/70">
        Sentences from{' '}
        <a href="https://tatoeba.org" target="_blank" rel="noreferrer" className="underline underline-offset-2">
          Tatoeba
        </a>
        , CC BY 2.0 FR. Word notes from{' '}
        <a href="https://en.wiktionary.org" target="_blank" rel="noreferrer" className="underline underline-offset-2">
          Wiktionary
        </a>
        , CC BY-SA 4.0
      </p>
    </section>
  )
}

/** One quiet line about the memory model that times the reviews. */
function memoryLine(progress: Progress): string {
  const answers = progress.reviews.length
  const m = progress.model
  if (!m) {
    return answers < MIN_REVIEWS
      ? `Reviews will be tuned to your memory after ${MIN_REVIEWS} answers. ${answers} so far.`
      : 'Tuning reviews to your memory.'
  }
  const better = Math.max(0, Math.round((1 - m.logLoss / m.defaultLogLoss) * 100))
  return `Reviews are tuned to your memory, from ${m.reviews} answers${better > 0 ? `, ${better}% more accurate than the default` : ''}.`
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col-reverse items-center">
      <dt className="mt-1 text-[13px] text-muted-foreground">{label}</dt>
      <dd className="text-[28px] leading-none font-semibold tracking-[-0.02em]">{value}</dd>
    </div>
  )
}
