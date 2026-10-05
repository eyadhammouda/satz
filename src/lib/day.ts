/** Study days run from 04:00 to 04:00 local time, because late sessions belong to the evening before. */
export const DAY_START_HOUR = 4

const pad = (n: number) => String(n).padStart(2, '0')

/** The study day for a moment in time, as YYYY-MM-DD in local time. */
export function studyDay(now: Date | number = new Date()): string {
  const shifted = new Date(typeof now === 'number' ? now : now.getTime())
  shifted.setHours(shifted.getHours() - DAY_START_HOUR)
  return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}-${pad(shifted.getDate())}`
}
