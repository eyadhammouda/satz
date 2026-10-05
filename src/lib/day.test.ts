import { describe, expect, it } from 'vitest'
import { studyDay } from './day'

describe('studyDay', () => {
  it('returns the previous calendar date at 02:00 local time', () => {
    expect(studyDay(new Date(2026, 9, 5, 2, 0))).toBe('2026-10-04')
  })

  it('switches at 04:00', () => {
    expect(studyDay(new Date(2026, 9, 5, 3, 59))).toBe('2026-10-04')
    expect(studyDay(new Date(2026, 9, 5, 4, 0))).toBe('2026-10-05')
  })

  it('crosses month and year boundaries', () => {
    expect(studyDay(new Date(2026, 0, 1, 1, 30))).toBe('2025-12-31')
    expect(studyDay(new Date(2026, 2, 1, 0, 0))).toBe('2026-02-28')
  })
})
