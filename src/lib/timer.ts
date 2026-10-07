/** One lesson lasts 30 minutes of active study. */
export const LESSON_MS = 30 * 60_000
/** Without a key press, click or tap for this long, the clock stops at the last activity. */
export const IDLE_MS = 2 * 60_000

/**
 * Counts active study time. Time only accrues between activity pings that are
 * close together, so leaving the tab, walking away or closing the laptop does
 * not use up the lesson.
 */
export interface Clock {
  /** Active milliseconds counted so far. */
  activeMs: number
  /** Time of the last activity, or null while paused. */
  lastActive: number | null
}

export const newClock = (): Clock => ({ activeMs: 0, lastActive: null })

/** Records activity at `now`. A gap longer than IDLE_MS is not counted. */
export function ping(clock: Clock, now: number): Clock {
  if (clock.lastActive === null) return { ...clock, lastActive: now }
  const gap = Math.max(0, now - clock.lastActive)
  return { activeMs: clock.activeMs + (gap <= IDLE_MS ? gap : 0), lastActive: now }
}

/** Stops the clock at `now`, counting the time since the last activity if it was recent. */
export function pause(clock: Clock, now: number): Clock {
  return { ...ping(clock, now), lastActive: null }
}

/** Active time as of `now`, without changing the clock. Idle time beyond IDLE_MS is not shown. */
export function elapsed(clock: Clock, now: number): number {
  if (clock.lastActive === null) return clock.activeMs
  const gap = Math.max(0, now - clock.lastActive)
  return clock.activeMs + Math.min(gap, IDLE_MS)
}

export const remaining = (clock: Clock, now: number) => Math.max(0, LESSON_MS - elapsed(clock, now))

export const isIdle = (clock: Clock, now: number) => clock.lastActive !== null && now - clock.lastActive > IDLE_MS

export function formatClock(ms: number): string {
  const seconds = Math.ceil(ms / 1000)
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
