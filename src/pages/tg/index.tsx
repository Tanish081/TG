import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { FlameKindling, UsersRound, AlertTriangle, Award, Users, FileDown } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/use-auth"
import {
  computeDailyAttendance,
  currentAbsenceStreak,
  ABSENCE_FLAG_THRESHOLD,
  type DailyAttendance,
} from "@/lib/attendance-daily"
import { generateWeeklyReportPdf } from "@/lib/weekly-report"
import { displayRoll } from "@/lib/roll-code"
import { cn } from "@/lib/utils"
import { SectionShell } from "@/components/section-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { Database } from "@/types/database"

type EnrollmentWithStudent = Database["public"]["Tables"]["student_enrollments"]["Row"] & {
  student: { name: string; prn: string | null } | null
}

interface AttendanceRow {
  enrollment_id: string
  status: string
  session: { date: string; subject: { code: string; name: string } | null } | null
}

interface CohortMemberSubjectRow {
  enrollment_id: string
  cohort: { subject: { code: string; name: string } | null } | null
}

const LOW_ATTENDANCE_THRESHOLD = 75

function StatTile({
  icon: Icon,
  iconClassName,
  label,
  value,
  accentClassName,
}: {
  icon: typeof Users
  iconClassName: string
  label: string
  value: string
  accentClassName?: string
}) {
  return (
    <Card className="border-slate-200/70 bg-white/70 shadow-sm backdrop-blur-sm">
      <CardHeader className="pb-2">
        <div className={cn("mb-1 flex size-9 items-center justify-center rounded-xl", iconClassName)}>
          <Icon className="size-4.5" />
        </div>
        <CardDescription className="text-slate-500">{label}</CardDescription>
        <CardTitle className={cn("text-2xl font-bold tracking-tight text-slate-900", accentClassName)}>
          {value}
        </CardTitle>
      </CardHeader>
    </Card>
  )
}

export default function TgDashboardPage() {
  const { teacher } = useAuth()

  const { data: batches } = useQuery({
    queryKey: ["my-batches", teacher?.id],
    enabled: !!teacher,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("batches")
        .select("*")
        .eq("tg_teacher_id", teacher!.id)
      if (error) throw error
      return data
    },
  })

  const { data: enrollments, isLoading } = useQuery({
    queryKey: ["my-batch-enrollments", batches?.map((b) => b.id)],
    enabled: !!batches && batches.length > 0,
    queryFn: async () => {
      const results = await Promise.all(
        batches!.map((b) =>
          supabase
            .from("student_enrollments")
            .select("*, student:students(name, prn)")
            .eq("academic_year", b.academic_year)
            .eq("year_level", b.year_level)
            .eq("branch_code", b.branch_code)
            .eq("division", b.division)
            .gte("roll_seq", b.roll_start)
            .lte("roll_seq", b.roll_end),
        ),
      )
      for (const r of results) if (r.error) throw r.error
      return results.flatMap((r) => (r.data ?? []) as unknown as EnrollmentWithStudent[])
    },
  })

  const enrollmentIds = useMemo(() => enrollments?.map((e) => e.id) ?? [], [enrollments])

  const { data: attendance } = useQuery({
    queryKey: ["batch-attendance", enrollmentIds],
    enabled: enrollmentIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("attendance_records")
        .select("enrollment_id, status, session:attendance_sessions(date, subject:subjects(code, name))")
        .in("enrollment_id", enrollmentIds)
      if (error) throw error
      return (data ?? []) as unknown as AttendanceRow[]
    },
  })

  // The definitive subject list per student (regardless of whether they
  // have attendance data yet), same idea as the TG student detail page —
  // a subject with zero sessions this week should still show up as 0/0,
  // not silently vanish from the report.
  const { data: cohortSubjects } = useQuery({
    queryKey: ["batch-cohort-subjects", enrollmentIds],
    enabled: enrollmentIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cohort_members")
        .select("enrollment_id, cohort:cohorts(subject:subjects(code, name))")
        .in("enrollment_id", enrollmentIds)
      if (error) throw error
      return (data ?? []) as unknown as CohortMemberSubjectRow[]
    },
  })

  const { data: semesterResults } = useQuery({
    queryKey: ["batch-semester-results", enrollmentIds],
    enabled: enrollmentIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("semester_results")
        .select("*")
        .in("enrollment_id", enrollmentIds)
        .order("semester", { ascending: false })
      if (error) throw error
      return data
    },
  })

  const attendanceByEnrollment = useMemo(() => {
    const map = new Map<string, { present: number; total: number }>()
    for (const r of attendance ?? []) {
      const entry = map.get(r.enrollment_id) ?? { present: 0, total: 0 }
      entry.total += 1
      if (r.status === "present" || r.status === "late") entry.present += 1
      map.set(r.enrollment_id, entry)
    }
    return map
  }, [attendance])

  // Full (all-time) day-by-day attendance per student, combined across
  // subjects — feeds both the absence-streak count and the "Overall"
  // streak calendar in the PDF report.
  const dailyByEnrollment = useMemo(() => {
    const byEnrollment = new Map<string, { status: string; date: string }[]>()
    for (const r of attendance ?? []) {
      if (!r.session) continue
      const list = byEnrollment.get(r.enrollment_id) ?? []
      list.push({ status: r.status, date: r.session.date })
      byEnrollment.set(r.enrollment_id, list)
    }
    const map = new Map<string, DailyAttendance[]>()
    for (const [id, records] of byEnrollment) map.set(id, computeDailyAttendance(records))
    return map
  }, [attendance])

  const streakByEnrollment = useMemo(() => {
    const map = new Map<string, number>()
    for (const [id, daily] of dailyByEnrollment) map.set(id, currentAbsenceStreak(daily))
    return map
  }, [dailyByEnrollment])

  // Same idea, but split per subject — powers each subject's own streak
  // calendar in the PDF report.
  const subjectDailyByEnrollment = useMemo(() => {
    const byEnrollmentSubject = new Map<string, Map<string, { status: string; date: string }[]>>()
    for (const r of attendance ?? []) {
      if (!r.session?.subject) continue
      const subj = r.session.subject
      const m = byEnrollmentSubject.get(r.enrollment_id) ?? new Map<string, { status: string; date: string }[]>()
      const list = m.get(subj.code) ?? []
      list.push({ status: r.status, date: r.session.date })
      m.set(subj.code, list)
      byEnrollmentSubject.set(r.enrollment_id, m)
    }
    const result = new Map<string, Map<string, DailyAttendance[]>>()
    for (const [enrollId, subjMap] of byEnrollmentSubject) {
      const converted = new Map<string, DailyAttendance[]>()
      for (const [code, records] of subjMap) converted.set(code, computeDailyAttendance(records))
      result.set(enrollId, converted)
    }
    return result
  }, [attendance])

  const latestGpaByEnrollment = useMemo(() => {
    const map = new Map<string, number | null>()
    for (const r of semesterResults ?? []) {
      if (!map.has(r.enrollment_id)) map.set(r.enrollment_id, r.sgpa)
    }
    return map
  }, [semesterResults])

  // The current academic week, Monday through Saturday — not a rolling
  // 7-day window, so the report's "this week" lines up with an actual
  // calendar week (and the Mon-Sat day grid on each student's page).
  const weekRange = useMemo(() => {
    const today = new Date()
    const daysSinceMonday = (today.getDay() + 6) % 7 // Sun=0 -> 6, Mon=1 -> 0, ...
    const monday = new Date(today)
    monday.setDate(today.getDate() - daysSinceMonday)
    const saturday = new Date(monday)
    saturday.setDate(monday.getDate() + 5)
    const toISO = (d: Date) => d.toISOString().slice(0, 10)
    return { start: toISO(monday), end: toISO(saturday) }
  }, [])

  const weeklyAttendanceByEnrollment = useMemo(() => {
    const map = new Map<string, { present: number; total: number }>()
    for (const r of attendance ?? []) {
      if (!r.session || r.session.date < weekRange.start || r.session.date > weekRange.end) continue
      const entry = map.get(r.enrollment_id) ?? { present: 0, total: 0 }
      entry.total += 1
      if (r.status === "present" || r.status === "late") entry.present += 1
      map.set(r.enrollment_id, entry)
    }
    return map
  }, [attendance, weekRange])

  const subjectsByEnrollment = useMemo(() => {
    const map = new Map<string, Map<string, string>>()
    for (const cs of cohortSubjects ?? []) {
      const subj = cs.cohort?.subject
      if (!subj) continue
      const m = map.get(cs.enrollment_id) ?? new Map<string, string>()
      m.set(subj.code, subj.name)
      map.set(cs.enrollment_id, m)
    }
    return map
  }, [cohortSubjects])

  const [reportPending, setReportPending] = useState(false)

  async function handleDownloadReport() {
    if (!enrollments || !batches) return
    const students = enrollments
      .slice()
      .sort((a, b) => a.roll_seq - b.roll_seq)
      .map((e) => {
        const overall = attendanceByEnrollment.get(e.id) ?? { present: 0, total: 0 }
        const weekly = weeklyAttendanceByEnrollment.get(e.id) ?? { present: 0, total: 0 }
        const subjectNames = subjectsByEnrollment.get(e.id) ?? new Map<string, string>()
        const subjectDaily = subjectDailyByEnrollment.get(e.id) ?? new Map<string, DailyAttendance[]>()
        const inWeek = (d: DailyAttendance) => d.date >= weekRange.start && d.date <= weekRange.end
        const subjects = [...subjectNames.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([code, name]) => ({
            code,
            name,
            daily: (subjectDaily.get(code) ?? []).filter(inWeek),
          }))
        return {
          roll: displayRoll(e),
          name: e.student?.name ?? "—",
          prn: e.student?.prn ?? null,
          weeklyPresent: weekly.present,
          weeklyTotal: weekly.total,
          overallPresent: overall.present,
          overallTotal: overall.total,
          weekDaily: (dailyByEnrollment.get(e.id) ?? []).filter(inWeek),
          subjects,
        }
      })
    setReportPending(true)
    try {
      await generateWeeklyReportPdf({
        batchLabel: batches.map((b) => `${b.year_level}${b.division} ${b.roll_start}-${b.roll_end}`).join(", "),
        tgName: teacher?.name ?? "—",
        tgEmail: teacher?.email ?? null,
        rangeStart: weekRange.start,
        rangeEnd: weekRange.end,
        students,
        lowAttendanceThreshold: LOW_ATTENDANCE_THRESHOLD,
      })
    } finally {
      setReportPending(false)
    }
  }

  const flaggedCount = [...streakByEnrollment.values()].filter((s) => s >= ABSENCE_FLAG_THRESHOLD).length
  const lowAttendanceCount = (enrollments ?? []).filter((e) => {
    const a = attendanceByEnrollment.get(e.id)
    const pct = a && a.total > 0 ? (a.present / a.total) * 100 : 100
    return pct < LOW_ATTENDANCE_THRESHOLD
  }).length
  const avgSgpa = (() => {
    const vals = [...latestGpaByEnrollment.values()].filter((v): v is number => v !== null && v !== undefined)
    if (vals.length === 0) return "—"
    return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2)
  })()

  if (!batches || batches.length === 0) {
    return (
      <SectionShell icon={UsersRound} title="My TG group" accent="teal">
        <p className="text-sm text-slate-500">No batch assigned yet — ask your Dept Coordinator.</p>
      </SectionShell>
    )
  }

  return (
    <SectionShell
      icon={UsersRound}
      title="My TG group"
      subtitle={batches.map((b) => `${b.year_level}${b.division} ${b.roll_start}-${b.roll_end}`).join(", ")}
      accent="teal"
      action={
        <Button variant="outline" onClick={handleDownloadReport} disabled={!enrollments?.length || reportPending}>
          <FileDown className="size-4" /> {reportPending ? "Generating…" : "Download weekly report"}
        </Button>
      }
    >
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile icon={Users} iconClassName="bg-teal-100 text-teal-700" label="Students" value={String(enrollments?.length ?? 0)} />
        <StatTile
          icon={AlertTriangle}
          iconClassName="bg-amber-100 text-amber-600"
          label={`Low attendance (<${LOW_ATTENDANCE_THRESHOLD}%)`}
          value={String(lowAttendanceCount)}
          accentClassName={lowAttendanceCount > 0 ? "text-amber-600" : undefined}
        />
        <StatTile
          icon={FlameKindling}
          iconClassName="bg-red-100 text-red-600"
          label={`${ABSENCE_FLAG_THRESHOLD}+ day absence streak`}
          value={String(flaggedCount)}
          accentClassName={flaggedCount > 0 ? "text-red-600" : undefined}
        />
        <StatTile icon={Award} iconClassName="bg-sky-100 text-sky-600" label="Avg latest SGPA" value={avgSgpa} />
      </div>

      <Card className="border-slate-200/70 bg-white/70 shadow-sm backdrop-blur-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Roll</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Attendance</TableHead>
              <TableHead>Latest SGPA</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {enrollments
              ?.slice()
              .sort((a, b) => a.roll_seq - b.roll_seq)
              .map((e) => {
                const a = attendanceByEnrollment.get(e.id)
                const pct = a && a.total > 0 ? Math.round((a.present / a.total) * 100) : null
                const gpa = latestGpaByEnrollment.get(e.id)
                const low = pct !== null && pct < LOW_ATTENDANCE_THRESHOLD
                const streak = streakByEnrollment.get(e.id) ?? 0
                const flagged = streak >= ABSENCE_FLAG_THRESHOLD
                return (
                  <TableRow key={e.id}>
                    <TableCell className="font-mono">{displayRoll(e)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {e.student?.name}
                        {flagged && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <FlameKindling className="size-3.5 text-destructive" />
                            </TooltipTrigger>
                            <TooltipContent>{streak} consecutive days absent</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {pct === null ? (
                        "—"
                      ) : (
                        <Badge variant={low ? "destructive" : "secondary"}>{pct}%</Badge>
                      )}
                    </TableCell>
                    <TableCell>{gpa ?? "—"}</TableCell>
                    <TableCell>
                      <Link to={`/tg/${e.id}`} className="text-sm font-medium text-teal-700 underline-offset-4 hover:underline">
                        View
                      </Link>
                    </TableCell>
                  </TableRow>
                )
              })}
          </TableBody>
        </Table>
      </Card>
    </SectionShell>
  )
}
