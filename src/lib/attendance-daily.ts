export interface DailyAttendance {
  date: string
  present: number
  total: number
}

/** Groups raw records into one entry per calendar day that had a session, sorted ascending. */
export function computeDailyAttendance(records: { status: string; date: string }[]): DailyAttendance[] {
  const map = new Map<string, DailyAttendance>()
  for (const r of records) {
    const entry = map.get(r.date) ?? { date: r.date, present: 0, total: 0 }
    entry.total += 1
    if (r.status === "present" || r.status === "late") entry.present += 1
    map.set(r.date, entry)
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Consecutive fully-absent days counting back from the most recent day that
 * had a session — i.e. "currently mid-streak," not the longest streak ever.
 * Skips days with zero sessions entirely (weekends/holidays never break or
 * extend a streak, since there's no data for them).
 */
export function currentAbsenceStreak(daily: DailyAttendance[]): number {
  let streak = 0
  for (let i = daily.length - 1; i >= 0; i--) {
    if (daily[i].present === 0) streak++
    else break
  }
  return streak
}

export const ABSENCE_FLAG_THRESHOLD = 3
