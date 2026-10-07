import { describe, expect, it } from 'vitest'
import { elapsed, formatClock, IDLE_MS, isIdle, LESSON_MS, newClock, pause, ping, remaining } from './timer'

describe('lesson clock', () => {
  it('counts time between close activity', () => {
    let c = ping(newClock(), 0)
    c = ping(c, 30_000)
    c = ping(c, 90_000)
    expect(c.activeMs).toBe(90_000)
    expect(remaining(c, 90_000)).toBe(LESSON_MS - 90_000)
  })

  it('does not count a long gap', () => {
    let c = ping(newClock(), 0)
    c = ping(c, 60_000)
    c = ping(c, 60_000 + IDLE_MS + 1)
    expect(c.activeMs).toBe(60_000)
  })

  it('shows at most IDLE_MS of trailing time and reports idle after that', () => {
    const c = ping(ping(newClock(), 0), 10_000)
    expect(elapsed(c, 10_000 + 30_000)).toBe(40_000)
    expect(elapsed(c, 10_000 + IDLE_MS * 5)).toBe(10_000 + IDLE_MS)
    expect(isIdle(c, 10_000 + IDLE_MS - 1)).toBe(false)
    expect(isIdle(c, 10_000 + IDLE_MS + 1)).toBe(true)
  })

  it('pauses and resumes without counting the break', () => {
    let c = ping(newClock(), 0)
    c = pause(c, 20_000)
    expect(c.lastActive).toBeNull()
    expect(elapsed(c, 10 * 60_000)).toBe(20_000)
    c = ping(c, 10 * 60_000)
    c = ping(c, 10 * 60_000 + 5_000)
    expect(c.activeMs).toBe(25_000)
  })

  it('formats minutes and seconds', () => {
    expect(formatClock(LESSON_MS)).toBe('30:00')
    expect(formatClock(61_000)).toBe('1:01')
    expect(formatClock(500)).toBe('0:01')
    expect(formatClock(0)).toBe('0:00')
  })
})
