import { Button } from '@/components/ui/button'
import { isDue } from '@/lib/schedule'
import type { Sentence } from '@/lib/types'

/** Daily target for new sentences. It is a guide, not a limit. */
export const DAILY_TARGET = 15

interface Props {
  sentences: Sentence[]
  today: string
  onStartReview: () => void
  onPractise: () => void
  onAdd: () => void
}

export default function Today({ sentences, today, onStartReview, onPractise, onAdd }: Props) {
  if (sentences.length === 0) {
    return (
      <section className="flex flex-col items-center pt-[12vh] text-center">
        <h1 className="text-[28px] leading-tight font-semibold tracking-tight">Add your first sentences</h1>
        <Button size="lg" className="mt-8 w-full max-w-[280px]" onClick={onAdd}>
          Add sentences
        </Button>
      </section>
    )
  }

  const due = sentences.filter((s) => isDue(s, today)).length
  const addedToday = sentences.filter((s) => s.createdDay === today).length

  return (
    <section className="flex flex-col items-center pt-[10vh] text-center">
      {due > 0 ? (
        <h1 className="flex flex-col items-center">
          <span className="text-[88px] leading-none font-semibold tracking-[-0.04em] tabular-nums">{due}</span>
          <span className="mt-2 text-[17px] text-muted-foreground">due</span>
        </h1>
      ) : (
        <h1 className="text-[28px] leading-tight font-semibold tracking-tight">All done for today</h1>
      )}

      <div className="mt-12 flex w-full max-w-[280px] flex-col gap-3">
        {due > 0 && (
          <Button size="lg" onClick={onStartReview}>
            Start review
          </Button>
        )}
        {addedToday > 0 && (
          <Button size="lg" variant={due > 0 ? 'secondary' : 'default'} onClick={onPractise}>
            Practise today's sentences ({addedToday})
          </Button>
        )}
      </div>

      <p className="mt-12 text-[13px] text-muted-foreground tabular-nums">
        {sentences.length} {sentences.length === 1 ? 'sentence' : 'sentences'}
        <span aria-hidden className="mx-2">
          ·
        </span>
        {addedToday < DAILY_TARGET
          ? `${addedToday} of ${DAILY_TARGET} added today`
          : `${addedToday} added today`}
      </p>
    </section>
  )
}
