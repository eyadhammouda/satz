import { useRef } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useNow } from '@/hooks/useProgress'
import { studyDay } from '@/lib/day'
import { dueReviewCount, type Progress } from '@/lib/lesson'
import { exportProgress, readProgressFile } from '@/lib/progress'
import { elapsed, formatClock, LESSON_MS } from '@/lib/timer'

interface Props {
  progress: Progress
  total: number | null
  onStart: () => void
  onImport: (progress: Progress) => void
}

export default function Home({ progress, total, onStart, onImport }: Props) {
  const now = useNow(30_000)
  const fileRef = useRef<HTMLInputElement>(null)
  const due = dueReviewCount(progress, now)
  const learned = progress.next
  const today = studyDay(now)
  const todays = progress.history.filter((h) => studyDay(h.started) === today)
  const minutesToday = Math.round(todays.reduce((sum, h) => sum + h.activeMs, 0) / 60_000)
  const learnedToday = todays.reduce((sum, h) => sum + h.introduced, 0)
  // A lesson left unfinished on an earlier day is not continued; a fresh hour starts instead.
  const open = progress.lesson && studyDay(progress.lesson.started) === today ? progress.lesson : null
  const left = open ? Math.max(0, LESSON_MS - elapsed(open.clock, now)) : 0
  const finished = total !== null && learned >= total && due === 0

  const importFile = async (file: File) => {
    try {
      onImport(await readProgressFile(file))
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
          ? 'One hour. As many German sentences as you can hold.'
          : due > 0
            ? `${due} ${due === 1 ? 'sentence' : 'sentences'} to review, then new ones`
            : 'Nothing to review. All new sentences today'}
      </p>

      <div className="mt-12 flex w-full max-w-[280px] flex-col gap-3">
        <Button size="lg" onClick={onStart} disabled={total === null || finished}>
          {open ? `Continue lesson · ${formatClock(left)} left` : "Start today's lesson"}
        </Button>
      </div>

      {total === null && <p className="mt-4 text-[13px] text-muted-foreground">Loading sentences</p>}

      <dl className="mt-14 flex gap-12 tabular-nums">
        <Stat label="Learned" value={learned} />
        <Stat label="Today" value={learnedToday} />
        <Stat label="Minutes today" value={minutesToday} />
      </dl>

      <div className="mt-auto flex justify-center gap-2 pt-14">
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => exportProgress(progress, today)}>
          Export
        </Button>
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => fileRef.current?.click()}>
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
        , CC BY 2.0 FR
      </p>
    </section>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col-reverse items-center">
      <dt className="mt-1 text-[13px] text-muted-foreground">{label}</dt>
      <dd className="text-[28px] leading-none font-semibold tracking-[-0.02em]">{value}</dd>
    </div>
  )
}
