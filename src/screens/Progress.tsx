import { ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useNow } from '@/hooks/useProgress'
import type { Progress as ProgressData } from '@/lib/lesson'
import { MIN_REVIEWS } from '@/lib/model'
import { computeStats } from '@/lib/stats'

interface Props {
  progress: ProgressData
  onBack: () => void
}

const percent = (x: number) => `${Math.round(x * 100)}%`

/** One quiet page on how learning is going: what is remembered, how strongly, and how much time went in. */
export default function ProgressView({ progress, onBack }: Props) {
  const now = useNow(60_000)
  const s = computeStats(progress, now)
  const most = Math.max(30, ...s.minutes.map((m) => m.minutes))
  const bands = [
    { label: 'New', hint: 'under a week', value: s.strength.fresh },
    { label: 'Settling', hint: 'a week to a month', value: s.strength.settling },
    { label: 'Strong', hint: 'months', value: s.strength.strong },
    { label: 'Lasting', hint: 'half a year or more', value: s.strength.lasting },
  ]
  const m = progress.model

  return (
    <section className="flex flex-1 flex-col">
      <Button variant="ghost" size="sm" className="-ml-3 self-start text-muted-foreground" onClick={onBack}>
        <ChevronLeft />
        Back
      </Button>

      <h1 className="mt-6 text-[28px] leading-tight font-semibold tracking-tight">Progress</h1>

      <dl className="mt-8 grid grid-cols-3 gap-4 tabular-nums">
        <Stat label="Words learned" value={String(s.learned)} />
        <Stat label="Remembered now" value={s.learned ? percent(s.remembered) : '0%'} />
        <Stat label="Days in a row" value={String(s.streak)} />
      </dl>

      <h2 className="mt-12 text-[13px] text-muted-foreground">Last 14 days, minutes</h2>
      <div className="mt-3 flex h-24 items-end gap-1.5" role="img" aria-label="Minutes studied on each of the last 14 days">
        {s.minutes.map((d) => (
          <div
            key={d.day}
            className={`flex-1 rounded-[3px] ${d.minutes > 0 ? 'bg-foreground/80' : 'bg-muted'}`}
            style={{ height: `${d.minutes > 0 ? Math.max(6, (d.minutes / most) * 100) : 4}%` }}
            title={`${d.day}: ${d.minutes} min`}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
        <span>2 weeks ago</span>
        <span>Today</span>
      </div>

      <h2 className="mt-12 text-[13px] text-muted-foreground">How long your memory of each word lasts</h2>
      <ul className="mt-3 divide-y">
        {bands.map((b) => (
          <li key={b.label} className="flex items-baseline justify-between py-3">
            <span className="text-[15px]">
              {b.label} <span className="text-[13px] text-muted-foreground">{b.hint}</span>
            </span>
            <span className="text-[15px] tabular-nums">{b.value}</span>
          </li>
        ))}
      </ul>

      <h2 className="mt-12 text-[13px] text-muted-foreground">Coming up</h2>
      <ul className="mt-3 divide-y">
        <li className="flex items-baseline justify-between py-3 text-[15px]">
          <span>Reviews due by tomorrow</span>
          <span className="tabular-nums">{s.dueTomorrow}</span>
        </li>
        <li className="flex items-baseline justify-between py-3 text-[15px]">
          <span>Within a week</span>
          <span className="tabular-nums">{s.dueWeek}</span>
        </li>
        <li className="flex items-baseline justify-between py-3 text-[15px]">
          <span>First-try correct, last 30 days</span>
          <span className="tabular-nums">{s.accuracy === null ? 'None yet' : percent(s.accuracy)}</span>
        </li>
      </ul>

      <h2 className="mt-12 text-[13px] text-muted-foreground">Your memory model</h2>
      <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
        {m
          ? `Fitted to your ${m.reviews} answers on ${new Date(m.fitted).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}. It predicts what you remember ${percent(Math.max(0, 1 - m.logLoss / m.defaultLogLoss))} better than the average learner model, so reviews arrive closer to the moment you would forget.`
          : `Reviews use a model of the average learner for now. After ${MIN_REVIEWS} answers (${progress.reviews.length} so far), it is fitted to your own memory and refitted every week.`}
      </p>
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="mt-1 text-[13px] text-muted-foreground">{label}</dt>
      <dd className="text-[28px] leading-none font-semibold tracking-[-0.02em]">{value}</dd>
    </div>
  )
}
